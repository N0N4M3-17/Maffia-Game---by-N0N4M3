package com.maffia;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;

public class Main {
    private static final Gson GSON = new Gson();
    private static final Object LOCK = new Object();
    private static final GameState STATE = new GameState();

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3000"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/", Main::handleRequest);
        server.setExecutor(null);
        server.start();

        System.out.printf("Mafia LAN Java host running on http://0.0.0.0:%d%n", port);
        System.out.printf("Local access: http://localhost:%d%n", port);
        for (String url : getLanUrls(port)) System.out.println("LAN access: " + url);
    }

    private static void handleRequest(HttpExchange ex) throws IOException {
        try {
            String path = ex.getRequestURI().getPath();
            if (path.startsWith("/api/")) handleApi(ex, path);
            else serveStatic(ex, path);
        } catch (Exception err) {
            writeJson(ex, 500, Map.of("error", "Internal server error: " + err.getMessage()));
        } finally {
            ex.close();
        }
    }

    private static void handleApi(HttpExchange ex, String path) throws IOException {
        String method = ex.getRequestMethod();

        if ("GET".equals(method) && "/api/server-info".equals(path)) {
            int port = ex.getLocalAddress().getPort();
            writeJson(ex, 200, Map.of("port", port, "localhost", "http://localhost:" + port, "lanUrls", getLanUrls(port)));
            return;
        }

        synchronized (LOCK) {
            tickPhaseTransitions();

            if ("GET".equals(method) && "/api/gm-state".equals(path)) {
                writeJson(ex, 200, gmStatePayload());
                return;
            }

            if ("POST".equals(method) && "/api/join".equals(path)) {
                JsonObject b = readBodyJson(ex);
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(ex, 409, Map.of("error", "Game already started."));
                    return;
                }
                String name = b.has("name") ? b.get("name").getAsString().trim() : "";
                if (name.isBlank()) {
                    writeJson(ex, 400, Map.of("error", "Name is required."));
                    return;
                }
                if (name.length() > 24) {
                    writeJson(ex, 400, Map.of("error", "Name max length is 24."));
                    return;
                }
                String id = generateSessionId(name);
                while (findPlayer(id) != null) id = generateSessionId(name);
                Player p = new Player(id, name);
                STATE.players.add(p);
                writeJson(ex, 201, Map.of("playerId", p.id));
                return;
            }

            if ("GET".equals(method) && path.startsWith("/api/player-state/")) {
                String pid = path.substring("/api/player-state/".length());
                Player p = findPlayer(pid);
                if (p == null) {
                    writeJson(ex, 404, Map.of("error", "Player not found."));
                    return;
                }
                writeJson(ex, 200, playerStatePayload(p));
                return;
            }

            if ("POST".equals(method) && "/api/gm/config".equals(path)) {
                JsonObject b = readBodyJson(ex);
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(ex, 409, Map.of("error", "Cannot update config after game start."));
                    return;
                }
                RoleConfig cfg = new RoleConfig(
                        intValue(b, "mafia"), intValue(b, "sheriff"), intValue(b, "doctor"),
                        intValue(b, "vigilante"), intValue(b, "town"),
                        b.has("vigilanteShots") ? b.get("vigilanteShots").getAsInt() : 1
                );
                if (!cfg.valid()) {
                    writeJson(ex, 400, Map.of("error", "All role values must be integers >= 0 (vigilanteShots >= 0)."));
                    return;
                }
                STATE.config = cfg;
                writeJson(ex, 200, Map.of("ok", true, "config", cfg.toMap(), "expectedRoleTotal", rolePool(cfg).size()));
                return;
            }

            if ("POST".equals(method) && "/api/gm/settings".equals(path)) {
                JsonObject b = readBodyJson(ex);
                TimerSettings t = new TimerSettings(
                        positiveSecondOrDefault(b, "nightMafiaSec", STATE.timerSettings.nightMafiaSec),
                        positiveSecondOrDefault(b, "nightSheriffSec", STATE.timerSettings.nightSheriffSec),
                        positiveSecondOrDefault(b, "nightDoctorSec", STATE.timerSettings.nightDoctorSec),
                        positiveSecondOrDefault(b, "nightVigilanteSec", STATE.timerSettings.nightVigilanteSec),
                        positiveSecondOrDefault(b, "morningSec", STATE.timerSettings.morningSec),
                        positiveSecondOrDefault(b, "discussionSec", STATE.timerSettings.discussionSec),
                        positiveSecondOrDefault(b, "dayVoteSec", STATE.timerSettings.dayVoteSec)
                );
                STATE.timerSettings = t;
                if (!"lobby".equals(STATE.phase) && !"game_over".equals(STATE.phase)) {
                    STATE.phaseEndsAt = System.currentTimeMillis() + (phaseDurationSec(STATE.phase) * 1000L);
                }
                writeJson(ex, 200, Map.of("ok", true, "timerSettings", t.toMap()));
                return;
            }

            if ("POST".equals(method) && "/api/gm/start".equals(path)) {
                startGame(ex);
                return;
            }

            if ("POST".equals(method) && "/api/gm/start-night".equals(path)) {
                if (!("night0".equals(STATE.phase) || "day_vote".equals(STATE.phase) || "discussion".equals(STATE.phase) || "morning".equals(STATE.phase))) {
                    writeJson(ex, 400, Map.of("error", "Cannot start night from current phase."));
                    return;
                }
                beginNight();
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/gm/next-phase".equals(path)) {
                nextPhaseInternal();
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/gm/start-discussion".equals(path)) {
                JsonObject b = readBodyJson(ex);
                int sec = b.has("seconds") ? Math.max(1, b.get("seconds").getAsInt()) : STATE.timerSettings.discussionSec;
                STATE.timerSettings.discussionSec = sec;
                setPhase("discussion");
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/gm/reset".equals(path)) {
                STATE.reset();
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/mafia-vote".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(b, "Mafia", "night_mafia");
                if (actor == null) { writeJson(ex, 400, Map.of("error", STATE.lastError)); return; }
                String target = b.get("targetId").getAsString();
                if (!isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                STATE.mafiaVotes.put(actor.id, target);
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/sheriff-investigate".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(b, "Sheriff", "night_sheriff");
                if (actor == null) { writeJson(ex, 400, Map.of("error", STATE.lastError)); return; }
                String target = b.get("targetId").getAsString();
                Player t = findPlayer(target);
                if (t == null || !t.alive) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                STATE.sheriffTarget = target;
                actor.lastSheriffResult = "Mafia".equals(t.role) ? "Mafia" : "Town";
                STATE.lastSheriffResult = actor.name + " -> " + t.name + " is " + actor.lastSheriffResult;
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/doctor-protect".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(b, "Doctor", "night_doctor");
                if (actor == null) { writeJson(ex, 400, Map.of("error", STATE.lastError)); return; }
                String target = b.get("targetId").getAsString();
                if (!isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                if (target.equals(actor.lastDoctorTarget)) { writeJson(ex, 400, Map.of("error", "Doctor cannot protect same target consecutively.")); return; }
                STATE.doctorTarget = target;
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/vigilante-shoot".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(b, "Vigilante", "night_vigilante");
                if (actor == null) { writeJson(ex, 400, Map.of("error", STATE.lastError)); return; }
                String target = b.has("targetId") && !b.get("targetId").isJsonNull() ? b.get("targetId").getAsString() : "";
                if (!target.isBlank()) {
                    if (target.equals(actor.id)) { writeJson(ex, 400, Map.of("error", "Vigilante cannot self target.")); return; }
                    if (!isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                    if (actor.vigilanteShotsRemaining <= 0) { writeJson(ex, 400, Map.of("error", "No shots remaining.")); return; }
                }
                STATE.vigilanteTarget = target.isBlank() ? null : target;
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/day-vote".equals(path)) {
                JsonObject b = readBodyJson(ex);
                String pid = b.has("playerId") ? b.get("playerId").getAsString() : "";
                Player actor = findPlayer(pid);
                if (actor == null || !actor.alive) { writeJson(ex, 400, Map.of("error", "Alive player required.")); return; }
                if (!"day_vote".equals(STATE.phase)) { writeJson(ex, 400, Map.of("error", "Not in day vote phase.")); return; }
                String target = b.has("targetId") && !b.get("targetId").isJsonNull() ? b.get("targetId").getAsString() : "";
                if (!target.isBlank() && !isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive or abstain.")); return; }
                STATE.dayVotes.put(actor.id, target.isBlank() ? null : target);
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/mafia-chat".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(b, "Mafia", "night_mafia");
                if (actor == null) { writeJson(ex, 400, Map.of("error", STATE.lastError)); return; }
                String msg = b.has("message") ? b.get("message").getAsString().trim() : "";
                if (msg.isBlank()) { writeJson(ex, 400, Map.of("error", "message required")); return; }
                STATE.mafiaChat.add(new ChatMessage(actor.name, msg));
                if (STATE.mafiaChat.size() > 50) STATE.mafiaChat.remove(0);
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }
        }

        writeJson(ex, 404, Map.of("error", "API route not found."));
    }

    private static void tickPhaseTransitions() {
        int guard = 0;
        while (!"lobby".equals(STATE.phase) && !"game_over".equals(STATE.phase) && STATE.phaseEndsAt > 0 && System.currentTimeMillis() >= STATE.phaseEndsAt && guard < 8) {
            nextPhaseInternal();
            guard += 1;
        }
    }

    private static int phaseDurationSec(String phase) {
        return switch (phase) {
            case "night0" -> STATE.timerSettings.nightMafiaSec;
            case "night_mafia" -> STATE.timerSettings.nightMafiaSec;
            case "night_sheriff" -> STATE.timerSettings.nightSheriffSec;
            case "night_doctor" -> STATE.timerSettings.nightDoctorSec;
            case "night_vigilante" -> STATE.timerSettings.nightVigilanteSec;
            case "morning" -> STATE.timerSettings.morningSec;
            case "discussion" -> STATE.timerSettings.discussionSec;
            case "day_vote" -> STATE.timerSettings.dayVoteSec;
            default -> 0;
        };
    }

    private static void setPhase(String phase) {
        STATE.phase = phase;
        int sec = phaseDurationSec(phase);
        STATE.phaseEndsAt = sec > 0 ? System.currentTimeMillis() + sec * 1000L : 0L;
    }

    private static void startGame(HttpExchange ex) throws IOException {
        if (!"lobby".equals(STATE.phase)) {
            writeJson(ex, 409, Map.of("error", "Game already started."));
            return;
        }
        if (STATE.players.size() < 3) {
            writeJson(ex, 400, Map.of("error", "Need at least 3 players to start (testing mode)."));
            return;
        }
        if (!hasMinimumTestRoles(STATE.config)) {
            writeJson(ex, 400, Map.of("error", "Testing launch requires: at least 1 Mafia, at least 1 Sheriff/Doctor/Vigilante, and at least 1 Town."));
            return;
        }
        List<String> pool = rolePool(STATE.config);
        if (pool.size() != STATE.players.size()) {
            writeJson(ex, 400, Map.of("error", "Role count (%d) must equal player count (%d).".formatted(pool.size(), STATE.players.size())));
            return;
        }

        Collections.shuffle(pool);
        for (int i = 0; i < STATE.players.size(); i++) {
            Player p = STATE.players.get(i);
            p.role = pool.get(i);
            p.alive = true;
            p.lastDoctorTarget = null;
            p.lastSheriffResult = null;
            p.vigilanteShotsRemaining = "Vigilante".equals(p.role) ? STATE.config.vigilanteShots : 0;
        }

        STATE.round = 0;
        STATE.winner = null;
        setPhase("night0");
        writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
    }

    private static void beginNight() {
        STATE.round += 1;
        STATE.nightStep = "mafia";
        STATE.mafiaVotes.clear();
        STATE.sheriffTarget = null;
        STATE.doctorTarget = null;
        STATE.vigilanteTarget = null;
        STATE.dayVotes.clear();
        STATE.morningDeaths = new ArrayList<>();
        for (Player p : STATE.players) {
            if ("Sheriff".equals(p.role)) p.lastSheriffResult = null;
        }
        setPhase("night_mafia");
    }

    private static void nextPhaseInternal() {
        if ("game_over".equals(STATE.phase)) return;
        switch (STATE.phase) {
            case "night0" -> beginNight();
            case "night_mafia" -> {
                if (aliveRoleExists("Sheriff")) setPhase("night_sheriff");
                else if (aliveRoleExists("Doctor")) setPhase("night_doctor");
                else if (aliveRoleExists("Vigilante")) setPhase("night_vigilante");
                else endNightAndEnterMorning();
            }
            case "night_sheriff" -> {
                if (aliveRoleExists("Doctor")) setPhase("night_doctor");
                else if (aliveRoleExists("Vigilante")) setPhase("night_vigilante");
                else endNightAndEnterMorning();
            }
            case "night_doctor" -> {
                if (aliveRoleExists("Vigilante")) setPhase("night_vigilante");
                else endNightAndEnterMorning();
            }
            case "night_vigilante" -> {
                endNightAndEnterMorning();
            }
            case "morning" -> setPhase("discussion");
            case "discussion" -> setPhase("day_vote");
            case "day_vote" -> {
                resolveDayVote();
                checkWin();
                if (!"game_over".equals(STATE.phase)) beginNight();
            }
        }
    }

    private static void endNightAndEnterMorning() {
        resolveNight();
        setPhase("morning");
        checkWin();
    }

    private static void resolveNight() {
        String protectedId = STATE.doctorTarget;
        Player doctor = aliveByRole("Doctor");
        if (doctor != null) doctor.lastDoctorTarget = protectedId;

        String mafiaTarget = majorityTarget(STATE.mafiaVotes, alivePlayersByRole("Mafia").size());
        String vigTarget = STATE.vigilanteTarget;
        Player vig = aliveByRole("Vigilante");
        if (vig != null && vigTarget != null && !vigTarget.isBlank() && vig.vigilanteShotsRemaining > 0) vig.vigilanteShotsRemaining -= 1;
        else vigTarget = null;

        List<String> deaths = new ArrayList<>();
        if (mafiaTarget != null && !mafiaTarget.equals(protectedId)) deaths.add(mafiaTarget);
        if (vigTarget != null && !vigTarget.equals(protectedId) && !deaths.contains(vigTarget)) deaths.add(vigTarget);

        for (String id : deaths) {
            Player p = findPlayer(id);
            if (p != null && p.alive) {
                p.alive = false;
                STATE.morningDeaths.add(Map.of("id", p.id, "name", p.name, "role", p.role));
            }
        }
    }

    private static void resolveDayVote() {
        String target = pluralityTarget(STATE.dayVotes, true);
        if (target != null) {
            Player p = findPlayer(target);
            if (p != null && p.alive) {
                p.alive = false;
                STATE.morningDeaths = List.of(Map.of("id", p.id, "name", p.name, "role", p.role));
            }
        } else STATE.morningDeaths = new ArrayList<>();
    }

    private static void checkWin() {
        long mafiaAlive = alivePlayersByRole("Mafia").size();
        long townAlive = STATE.players.stream().filter(p -> p.alive && !"Mafia".equals(p.role)).count();
        if (mafiaAlive == 0) {
            STATE.phase = "game_over";
            STATE.winner = "Town";
            STATE.phaseEndsAt = 0;
        } else if (mafiaAlive >= townAlive) {
            STATE.phase = "game_over";
            STATE.winner = "Mafia";
            STATE.phaseEndsAt = 0;
        }
    }

    private static String majorityTarget(Map<String, String> voteMap, int voterCount) {
        return majorityTarget(voteMap, majorityThreshold(voterCount), false);
    }

    private static String majorityTarget(Map<String, String> voteMap, int needed, boolean allowNullVotes) {
        Map<String, Integer> counts = new HashMap<>();
        for (String t : voteMap.values()) {
            if (t == null && allowNullVotes) continue;
            if (t == null) continue;
            counts.put(t, counts.getOrDefault(t, 0) + 1);
        }
        String best = null;
        int bestCount = 0;
        boolean tie = false;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() > bestCount) {
                best = e.getKey();
                bestCount = e.getValue();
                tie = false;
            } else if (e.getValue() == bestCount) tie = true;
        }
        if (bestCount < needed || tie) return null;
        return best;
    }

    private static int majorityThreshold(int n) { return (n / 2) + 1; }

    private static String pluralityTarget(Map<String, String> voteMap, boolean allowNullVotes) {
        Map<String, Integer> counts = new HashMap<>();
        for (String t : voteMap.values()) {
            if (t == null && allowNullVotes) continue;
            if (t == null) continue;
            counts.put(t, counts.getOrDefault(t, 0) + 1);
        }
        String best = null;
        int bestCount = 0;
        boolean tie = false;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() > bestCount) {
                best = e.getKey();
                bestCount = e.getValue();
                tie = false;
            } else if (e.getValue() == bestCount) tie = true;
        }
        if (bestCount <= 0 || tie) return null;
        return best;
    }

    private static Player requireAlivePlayer(JsonObject b, String role, String phase) {
        String pid = b.has("playerId") ? b.get("playerId").getAsString() : "";
        Player p = findPlayer(pid);
        if (p == null || !p.alive) { STATE.lastError = "Alive player required."; return null; }
        if (!role.equals(p.role)) { STATE.lastError = "Role mismatch."; return null; }
        if (!phase.equals(STATE.phase)) { STATE.lastError = "Wrong phase."; return null; }
        return p;
    }

    private static boolean aliveRoleExists(String role) { return aliveByRole(role) != null; }
    private static Player aliveByRole(String role) { return STATE.players.stream().filter(p -> p.alive && role.equals(p.role)).findFirst().orElse(null); }
    private static List<Player> alivePlayersByRole(String role) { return STATE.players.stream().filter(p -> p.alive && role.equals(p.role)).collect(Collectors.toList()); }
    private static int aliveCount() { return (int) STATE.players.stream().filter(p -> p.alive).count(); }
    private static boolean isAlivePlayer(String id) { Player p = findPlayer(id); return p != null && p.alive; }

    private static Map<String, Object> gmStatePayload() {
        List<Map<String, Object>> players = new ArrayList<>();
        for (Player p : STATE.players) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", p.id);
            row.put("name", p.name);
            row.put("alive", p.alive);
            row.put("role", p.role);
            players.add(row);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("phase", STATE.phase);
        payload.put("round", STATE.round);
        payload.put("nightStep", STATE.nightStep);
        payload.put("phaseRemainingSec", phaseRemainingSec());
        payload.put("players", players);
        payload.put("playerCount", STATE.players.size());
        payload.put("aliveCount", aliveCount());
        payload.put("config", STATE.config.toMap());
        payload.put("timerSettings", STATE.timerSettings.toMap());
        payload.put("expectedRoleTotal", rolePool(STATE.config).size());
        payload.put("morningDeaths", STATE.morningDeaths);
        payload.put("winner", STATE.winner);
        payload.put("lastSheriffResult", STATE.lastSheriffResult);
        payload.put("mafiaVoteTally", tally(STATE.mafiaVotes));
        payload.put("dayVoteTally", tally(STATE.dayVotes));
        return payload;
    }

    private static Map<String, Object> playerStatePayload(Player p) {
        List<Map<String, Object>> players = new ArrayList<>();
        for (Player other : STATE.players) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", other.id);
            row.put("name", other.name);
            row.put("alive", other.alive);
            row.put("revealedRole", other.alive ? null : other.role);
            players.add(row);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", p.id);
        payload.put("name", p.name);
        payload.put("phase", STATE.phase);
        payload.put("alive", p.alive);
        payload.put("phaseRemainingSec", phaseRemainingSec());
        payload.put("role", "lobby".equals(STATE.phase) ? null : p.role);
        payload.put("roleDescription", roleDescription(p.role));
        payload.put("vigilanteShotsRemaining", p.vigilanteShotsRemaining);
        payload.put("sheriffResult", p.lastSheriffResult);
        payload.put("players", players);
        payload.put("morningDeaths", STATE.morningDeaths);
        payload.put("winner", STATE.winner);
        payload.put("mafiaVoteCurrent", STATE.mafiaVotes.get(p.id));
        payload.put("dayVoteCurrent", STATE.dayVotes.get(p.id));
        payload.put("timerSettings", STATE.timerSettings.toMap());

        if ("Mafia".equals(p.role) && p.alive && "night_mafia".equals(STATE.phase)) {
            List<Map<String, String>> chat = STATE.mafiaChat.stream().map(m -> Map.of("author", m.author, "message", m.message)).toList();
            payload.put("mafiaChat", chat);
        } else payload.put("mafiaChat", List.of());
        return payload;
    }

    private static long phaseRemainingSec() {
        if (STATE.phaseEndsAt <= 0) return 0;
        return Math.max(0, (STATE.phaseEndsAt - System.currentTimeMillis()) / 1000);
    }

    private static Map<String, Integer> tally(Map<String, String> votes) {
        Map<String, Integer> t = new HashMap<>();
        for (String v : votes.values()) {
            if (v == null) continue;
            t.put(v, t.getOrDefault(v, 0) + 1);
        }
        return t;
    }

    private static String roleDescription(String role) {
        return switch (role == null ? "" : role) {
            case "Mafia" -> "Eliminate town each night with your team.";
            case "Sheriff" -> "Investigate one player each night.";
            case "Doctor" -> "Protect one player each night (no consecutive same target).";
            case "Vigilante" -> "You have limited shots to kill at night.";
            case "Town" -> "Find and eliminate the mafia.";
            default -> "";
        };
    }

    private static String generateSessionId(String name) {
        String safe = name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (safe.isBlank()) safe = "player";
        int rand = ThreadLocalRandom.current().nextInt(1, 101);
        return safe + "-" + rand;
    }

    private static Player findPlayer(String id) {
        for (Player p : STATE.players) if (p.id.equals(id)) return p;
        return null;
    }

    private static boolean hasMinimumTestRoles(RoleConfig cfg) {
        return cfg.mafia >= 1 && (cfg.sheriff + cfg.doctor + cfg.vigilante) >= 1 && cfg.town >= 1;
    }

    private static int intValue(JsonObject body, String key) { return body.has(key) ? body.get(key).getAsInt() : -1; }
    private static int positiveSecondOrDefault(JsonObject body, String key, int fallback) {
        if (!body.has(key)) return fallback;
        return Math.max(1, body.get(key).getAsInt());
    }

    private static List<String> rolePool(RoleConfig cfg) {
        List<String> pool = new ArrayList<>();
        for (int i = 0; i < cfg.mafia; i++) pool.add("Mafia");
        for (int i = 0; i < cfg.sheriff; i++) pool.add("Sheriff");
        for (int i = 0; i < cfg.doctor; i++) pool.add("Doctor");
        for (int i = 0; i < cfg.vigilante; i++) pool.add("Vigilante");
        for (int i = 0; i < cfg.town; i++) pool.add("Town");
        return pool;
    }

    private static JsonObject readBodyJson(HttpExchange ex) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            byte[] bytes = in.readAllBytes();
            if (bytes.length == 0) return new JsonObject();
            return GSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
        } catch (Exception ignored) {
            return new JsonObject();
        }
    }

    private static void writeJson(HttpExchange ex, int status, Object data) throws IOException {
        byte[] bytes = GSON.toJson(data).getBytes(StandardCharsets.UTF_8);
        Headers h = ex.getResponseHeaders();
        h.set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) { out.write(bytes); }
    }

    private static void serveStatic(HttpExchange ex, String path) throws IOException {
        String normalized = "/".equals(path) ? "/index.html" : path;
        if (normalized.contains("..")) { ex.sendResponseHeaders(403, -1); return; }
        String resourcePath = "/public" + normalized;
        try (InputStream in = Main.class.getResourceAsStream(resourcePath)) {
            if (in == null) { ex.sendResponseHeaders(404, -1); return; }
            byte[] bytes = in.readAllBytes();
            ex.getResponseHeaders().set("Content-Type", contentType(normalized));
            ex.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = ex.getResponseBody()) { out.write(bytes); }
        }
    }

    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        return "text/plain; charset=utf-8";
    }

    private static List<String> getLanUrls(int port) {
        List<String> urls = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback()) continue;
                Enumeration<InetAddress> addrs = nic.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) urls.add("http://" + a.getHostAddress() + ":" + port);
                }
            }
        } catch (Exception ignored) {}
        return urls;
    }

    private static final class GameState {
        String phase = "lobby";
        String nightStep = "-";
        int round = 0;
        String winner = null;
        String lastError = null;
        String lastSheriffResult = null;
        long phaseEndsAt = 0L;

        List<Player> players = new ArrayList<>();
        RoleConfig config = new RoleConfig(2, 1, 1, 0, 1, 1);
        TimerSettings timerSettings = new TimerSettings(60, 60, 60, 60, 60, 60, 60);

        Map<String, String> mafiaVotes = new HashMap<>();
        String sheriffTarget = null;
        String doctorTarget = null;
        String vigilanteTarget = null;
        Map<String, String> dayVotes = new HashMap<>();

        List<Map<String, String>> morningDeaths = new ArrayList<>();
        List<ChatMessage> mafiaChat = new ArrayList<>();

        void reset() {
            phase = "lobby";
            nightStep = "-";
            round = 0;
            winner = null;
            lastError = null;
            lastSheriffResult = null;
            phaseEndsAt = 0L;
            players = new ArrayList<>();
            config = new RoleConfig(2, 1, 1, 0, 1, 1);
            timerSettings = new TimerSettings(60, 60, 60, 60, 60, 60, 60);
            mafiaVotes = new HashMap<>();
            sheriffTarget = null;
            doctorTarget = null;
            vigilanteTarget = null;
            dayVotes = new HashMap<>();
            morningDeaths = new ArrayList<>();
            mafiaChat = new ArrayList<>();
        }
    }

    private static final class RoleConfig {
        int mafia, sheriff, doctor, vigilante, town, vigilanteShots;

        RoleConfig(int mafia, int sheriff, int doctor, int vigilante, int town, int vigilanteShots) {
            this.mafia = mafia; this.sheriff = sheriff; this.doctor = doctor; this.vigilante = vigilante; this.town = town; this.vigilanteShots = vigilanteShots;
        }

        boolean valid() { return mafia >= 0 && sheriff >= 0 && doctor >= 0 && vigilante >= 0 && town >= 0 && vigilanteShots >= 0; }

        Map<String, Integer> toMap() {
            Map<String, Integer> map = new LinkedHashMap<>();
            map.put("mafia", mafia);
            map.put("sheriff", sheriff);
            map.put("doctor", doctor);
            map.put("vigilante", vigilante);
            map.put("town", town);
            map.put("vigilanteShots", vigilanteShots);
            return map;
        }
    }

    private static final class TimerSettings {
        int nightMafiaSec, nightSheriffSec, nightDoctorSec, nightVigilanteSec, morningSec, discussionSec, dayVoteSec;

        TimerSettings(int nightMafiaSec, int nightSheriffSec, int nightDoctorSec, int nightVigilanteSec, int morningSec, int discussionSec, int dayVoteSec) {
            this.nightMafiaSec = nightMafiaSec;
            this.nightSheriffSec = nightSheriffSec;
            this.nightDoctorSec = nightDoctorSec;
            this.nightVigilanteSec = nightVigilanteSec;
            this.morningSec = morningSec;
            this.discussionSec = discussionSec;
            this.dayVoteSec = dayVoteSec;
        }

        Map<String, Integer> toMap() {
            Map<String, Integer> m = new LinkedHashMap<>();
            m.put("nightMafiaSec", nightMafiaSec);
            m.put("nightSheriffSec", nightSheriffSec);
            m.put("nightDoctorSec", nightDoctorSec);
            m.put("nightVigilanteSec", nightVigilanteSec);
            m.put("morningSec", morningSec);
            m.put("discussionSec", discussionSec);
            m.put("dayVoteSec", dayVoteSec);
            return m;
        }
    }

    private static final class Player {
        String id, name, role;
        boolean alive;
        String lastDoctorTarget;
        String lastSheriffResult;
        int vigilanteShotsRemaining;

        Player(String id, String name) {
            this.id = id;
            this.name = name;
            this.alive = true;
            this.role = null;
            this.lastDoctorTarget = null;
            this.lastSheriffResult = null;
            this.vigilanteShotsRemaining = 0;
        }
    }

    private static final class ChatMessage {
        String author, message;
        ChatMessage(String author, String message) { this.author = author; this.message = message; }
    }
}
