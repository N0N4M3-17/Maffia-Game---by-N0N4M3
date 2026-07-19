package com.maffia;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

public class Main {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Object LOCK = new Object();
    private static final GameState STATE = new GameState();
    private static final LocalDatabase DB = new LocalDatabase(Path.of("data", "mafia-db.json"));
    private static final SecureRandom RNG = new SecureRandom();
    private static final List<String> PUBLIC_CHAT_PHASES = List.of("morning", "discussion", "day_vote");
    private static final List<String> PUBLIC_CHAT_VISIBLE_PHASES = List.of("morning", "final_statements", "discussion", "day_vote", "game_over");
    private static final String ADMIN_EMAIL = "gabi17hun@gmail.com";
    private static final String ADMIN_USERNAME = "n0n4m3-admin";
    private static final String ADMIN_PASSWORD = "admin123";
    private static final long ACTION_RESULT_HOLD_MS = 4500L;

    public static void main(String[] args) throws IOException {
        synchronized (LOCK) {
            DB.load();
            DB.seedAdmin();
            DB.ensureDefaultRoom();
            DB.save();
        }

        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3000"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);
        server.createContext("/", Main::handleRequest);
        server.setExecutor(null);
        server.start();
        startPhaseTicker();

        System.out.printf("Mafia LAN Java host running on http://0.0.0.0:%d%n", port);
        System.out.printf("Local access: http://localhost:%d%n", port);
        for (String url : getLanUrls(port)) System.out.println("LAN access: " + url);
    }

    private static void handleRequest(HttpExchange ex) throws IOException {
        try {
            addSecurityHeaders(ex);
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
            String publicUrl = System.getenv().getOrDefault("PUBLIC_URL", "");
            writeJson(ex, 200, Map.of(
                    "port", port,
                    "localhost", "http://localhost:" + port,
                    "lanUrls", getLanUrls(port),
                    "publicUrl", publicUrl,
                    "publicUrlSecure", publicUrl.startsWith("https://")
            ));
            return;
        }

        synchronized (LOCK) {
            tickPhaseTransitions();

            if ("POST".equals(method) && "/api/auth/register".equals(path)) {
                JsonObject b = readBodyJson(ex);
                String email = text(b, "email").toLowerCase();
                String username = text(b, "username");
                String password = text(b, "password");
                String error = validateRegistration(email, username, password);
                if (error != null) {
                    writeJson(ex, 400, Map.of("error", error));
                    return;
                }
                if (DB.findAccountByLogin(email) != null || DB.findAccountByLogin(username) != null) {
                    writeJson(ex, 409, Map.of("error", "Email or username is already registered."));
                    return;
                }
                Account account = Account.create(email, username, username, password, false);
                DB.data.accounts.add(account);
                String session = DB.createSession(account.id);
                DB.save();
                setSessionCookie(ex, session);
                writeJson(ex, 201, Map.of("account", accountPayload(account)));
                return;
            }

            if ("POST".equals(method) && "/api/auth/login".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Account account = DB.findAccountByLogin(text(b, "login"));
                if (account == null || !verifyPassword(text(b, "password"), account.salt, account.passwordHash)) {
                    writeJson(ex, 401, Map.of("error", "Invalid login or password."));
                    return;
                }
                String session = DB.createSession(account.id);
                DB.save();
                setSessionCookie(ex, session);
                writeJson(ex, 200, Map.of("account", accountPayload(account)));
                return;
            }

            if ("POST".equals(method) && "/api/auth/logout".equals(path)) {
                String token = sessionToken(ex);
                if (token != null) DB.data.sessions.remove(token);
                DB.save();
                clearSessionCookie(ex);
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("GET".equals(method) && "/api/me".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                writeJson(ex, 200, Map.of("account", accountPayload(account)));
                return;
            }

            if ("PUT".equals(method) && "/api/profile".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                JsonObject b = readBodyJson(ex);
                String displayName = text(b, "displayName");
                if (displayName.isBlank() || displayName.length() > 32) {
                    writeJson(ex, 400, Map.of("error", "Display name must be 1-32 characters."));
                    return;
                }
                String avatar = b.has("avatarDataUrl") && !b.get("avatarDataUrl").isJsonNull()
                        ? b.get("avatarDataUrl").getAsString().trim()
                        : account.avatarDataUrl;
                String avatarError = validateAvatar(avatar);
                if (avatarError != null) {
                    writeJson(ex, 400, Map.of("error", avatarError));
                    return;
                }
                account.displayName = displayName;
                account.avatarDataUrl = avatar;
                DB.save();
                syncPlayerName(account);
                writeJson(ex, 200, Map.of("account", accountPayload(account)));
                return;
            }

            if ("GET".equals(method) && "/api/admin/users".equals(path)) {
                Account admin = requireAdmin(ex);
                if (admin == null) return;
                writeJson(ex, 200, Map.of("users", DB.data.accounts.stream().map(Main::adminAccountPayload).toList()));
                return;
            }

            if ("POST".equals(method) && "/api/admin/users".equals(path)) {
                Account admin = requireAdmin(ex);
                if (admin == null) return;
                JsonObject b = readBodyJson(ex);
                String email = text(b, "email").toLowerCase();
                String username = text(b, "username");
                String displayName = text(b, "displayName");
                String password = text(b, "password");
                String error = validateRegistration(email, username, password);
                if (error != null) {
                    writeJson(ex, 400, Map.of("error", error));
                    return;
                }
                if (displayName.isBlank() || displayName.length() > 32) {
                    writeJson(ex, 400, Map.of("error", "Display name must be 1-32 characters."));
                    return;
                }
                if (DB.findAccountByLogin(email) != null || DB.findAccountByLogin(username) != null) {
                    writeJson(ex, 409, Map.of("error", "Email or username is already registered."));
                    return;
                }
                Account created = Account.create(email, username, displayName, password, b.has("isAdmin") && b.get("isAdmin").getAsBoolean());
                if (b.has("scoreWins")) created.scoreWins = Math.max(0, b.get("scoreWins").getAsInt());
                if (b.has("scoreLosses")) created.scoreLosses = Math.max(0, b.get("scoreLosses").getAsInt());
                if (b.has("scoreGames")) created.scoreGames = Math.max(created.scoreWins + created.scoreLosses, b.get("scoreGames").getAsInt());
                DB.data.accounts.add(created);
                DB.save();
                writeJson(ex, 201, Map.of("user", adminAccountPayload(created)));
                return;
            }

            if ("PUT".equals(method) && path.startsWith("/api/admin/users/")) {
                Account admin = requireAdmin(ex);
                if (admin == null) return;
                String id = path.substring("/api/admin/users/".length());
                Account target = DB.findAccount(id);
                if (target == null) {
                    writeJson(ex, 404, Map.of("error", "User not found."));
                    return;
                }
                JsonObject b = readBodyJson(ex);
                if (b.has("displayName")) {
                    String name = text(b, "displayName");
                    if (name.isBlank() || name.length() > 32) {
                        writeJson(ex, 400, Map.of("error", "Display name must be 1-32 characters."));
                        return;
                    }
                    target.displayName = name;
                    syncPlayerName(target);
                }
                if (b.has("username")) {
                    String username = text(b, "username");
                    if (!username.matches("^[A-Za-z0-9_.-]{3,24}$")) {
                        writeJson(ex, 400, Map.of("error", "Username must be 3-24 letters, numbers, dots, dashes, or underscores."));
                        return;
                    }
                    Account existing = DB.findAccountByLogin(username);
                    if (existing != null && !existing.id.equals(target.id)) {
                        writeJson(ex, 409, Map.of("error", "Username is already used."));
                        return;
                    }
                    target.username = username;
                }
                if (b.has("email")) {
                    String email = text(b, "email").toLowerCase();
                    if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
                        writeJson(ex, 400, Map.of("error", "Email is not valid."));
                        return;
                    }
                    Account existing = DB.findAccountByLogin(email);
                    if (existing != null && !existing.id.equals(target.id)) {
                        writeJson(ex, 409, Map.of("error", "Email is already used."));
                        return;
                    }
                    target.email = email;
                }
                if (b.has("isAdmin")) {
                    boolean nextAdmin = b.get("isAdmin").getAsBoolean();
                    if (!nextAdmin && target.isAdmin && DB.adminCount() <= 1) {
                        writeJson(ex, 400, Map.of("error", "At least one admin account must remain."));
                        return;
                    }
                    target.isAdmin = nextAdmin;
                }
                if (b.has("scoreWins")) target.scoreWins = Math.max(0, b.get("scoreWins").getAsInt());
                if (b.has("scoreLosses")) target.scoreLosses = Math.max(0, b.get("scoreLosses").getAsInt());
                if (b.has("scoreGames")) target.scoreGames = Math.max(target.scoreWins + target.scoreLosses, b.get("scoreGames").getAsInt());
                if (b.has("password") && !text(b, "password").isBlank()) target.setPassword(text(b, "password"));
                DB.save();
                writeJson(ex, 200, Map.of("user", adminAccountPayload(target)));
                return;
            }

            if ("DELETE".equals(method) && path.startsWith("/api/admin/users/")) {
                Account admin = requireAdmin(ex);
                if (admin == null) return;
                String id = path.substring("/api/admin/users/".length());
                if (admin.id.equals(id)) {
                    writeJson(ex, 400, Map.of("error", "The signed-in admin cannot delete themselves."));
                    return;
                }
                Account target = DB.findAccount(id);
                if (target != null && target.isAdmin && DB.adminCount() <= 1) {
                    writeJson(ex, 400, Map.of("error", "At least one admin account must remain."));
                    return;
                }
                boolean removed = DB.data.accounts.removeIf(a -> a.id.equals(id));
                DB.data.sessions.entrySet().removeIf(e -> e.getValue().accountId.equals(id));
                STATE.players.removeIf(p -> id.equals(p.accountId));
                DB.save();
                writeJson(ex, removed ? 200 : 404, removed ? Map.of("ok", true) : Map.of("error", "User not found."));
                return;
            }

            if ("GET".equals(method) && "/api/rooms".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                writeJson(ex, 200, Map.of("rooms", DB.data.rooms.stream().map(Main::roomPayload).toList()));
                return;
            }

            if ("POST".equals(method) && "/api/rooms".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!STATE.players.isEmpty() && !"game_over".equals(STATE.phase)) {
                    writeJson(ex, 409, Map.of("error", "Reset or finish the active room before creating a new hosted table."));
                    return;
                }
                JsonObject b = readBodyJson(ex);
                String name = text(b, "name");
                String mode = text(b, "networkMode");
                if (name.isBlank() || name.length() > 32) {
                    writeJson(ex, 400, Map.of("error", "Room name must be 1-32 characters."));
                    return;
                }
                Room room = Room.create(name, account.id, mode.isBlank() ? "local" : mode);
                DB.data.rooms.add(room);
                DB.data.activeRoomId = room.id;
                STATE.reset();
                DB.save();
                writeJson(ex, 201, Map.of("room", roomPayload(room)));
                return;
            }

            if ("POST".equals(method) && path.startsWith("/api/rooms/") && path.endsWith("/join")) {
                Account account = requireAccount(ex);
                if (account == null) return;
                String roomId = path.substring("/api/rooms/".length(), path.length() - "/join".length());
                Room room = DB.findRoom(roomId);
                if (room == null) {
                    writeJson(ex, 404, Map.of("error", "Room not found."));
                    return;
                }
                Room active = DB.defaultRoom();
                if (active != null && !active.id.equals(room.id)) {
                    if (!STATE.players.isEmpty() && !"game_over".equals(STATE.phase)) {
                        writeJson(ex, 409, Map.of("error", "Another room is active. Ask the host to reset before switching rooms."));
                        return;
                    }
                    DB.data.activeRoomId = room.id;
                    STATE.reset();
                }
                if (!"lobby".equals(STATE.phase) && STATE.players.stream().noneMatch(p -> account.id.equals(p.accountId))) {
                    writeJson(ex, 409, Map.of("error", "Game already started."));
                    return;
                }
                Player existing = findPlayerByAccount(account.id);
                if (existing == null) {
                    String id = generateSessionId(account.username);
                    while (findPlayer(id) != null) id = generateSessionId(account.username);
                    existing = new Player(id, account.id, account.displayName);
                    STATE.players.add(existing);
                }
                existing.roomId = room.id;
                room.lastActiveAt = Instant.now().toString();
                DB.save();
                writeJson(ex, 200, Map.of("playerId", existing.id, "room", roomPayload(room)));
                return;
            }

            if ("GET".equals(method) && "/api/gm-state".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                writeJson(ex, 200, gmStatePayload(account));
                return;
            }

            if ("GET".equals(method) && "/api/my-player".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                Player player = findPlayerByAccount(account.id);
                if (player == null) {
                    writeJson(ex, 200, Map.of("playerId", "", "joined", false));
                    return;
                }
                writeJson(ex, 200, Map.of(
                        "playerId", player.id,
                        "joined", true,
                        "room", roomPayload(DB.findRoom(player.roomId) == null ? DB.defaultRoom() : DB.findRoom(player.roomId))
                ));
                return;
            }

            if ("POST".equals(method) && "/api/join".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                Room room = DB.defaultRoom();
                Player existing = findPlayerByAccount(account.id);
                if (existing != null) {
                    writeJson(ex, 200, Map.of("playerId", existing.id));
                    return;
                }
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(ex, 409, Map.of("error", "Game already started."));
                    return;
                }
                String id = generateSessionId(account.username);
                while (findPlayer(id) != null) id = generateSessionId(account.username);
                Player p = new Player(id, account.id, account.displayName);
                p.roomId = room.id;
                STATE.players.add(p);
                writeJson(ex, 201, Map.of("playerId", p.id));
                return;
            }

            if ("GET".equals(method) && path.startsWith("/api/player-state/")) {
                Account account = requireAccount(ex);
                if (account == null) return;
                String pid = path.substring("/api/player-state/".length());
                Player p = findPlayer(pid);
                if (p == null || !account.id.equals(p.accountId)) {
                    writeJson(ex, 404, Map.of("error", "Player not found."));
                    return;
                }
                writeJson(ex, 200, playerStatePayload(p, account));
                return;
            }

            if ("POST".equals(method) && "/api/gm/config".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can change game setup."));
                    return;
                }
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
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can change timer settings."));
                    return;
                }
                JsonObject b = readBodyJson(ex);
                TimerSettings t = new TimerSettings(
                        positiveSecondOrDefault(b, "nightMafiaSec", STATE.timerSettings.nightMafiaSec),
                        positiveSecondOrDefault(b, "nightSheriffSec", STATE.timerSettings.nightSheriffSec),
                        positiveSecondOrDefault(b, "nightDoctorSec", STATE.timerSettings.nightDoctorSec),
                        positiveSecondOrDefault(b, "nightVigilanteSec", STATE.timerSettings.nightVigilanteSec),
                        positiveSecondOrDefault(b, "morningSec", STATE.timerSettings.morningSec),
                        positiveSecondOrDefault(b, "finalStatementSec", STATE.timerSettings.finalStatementSec),
                        positiveSecondOrDefault(b, "discussionSec", STATE.timerSettings.discussionSec),
                        positiveSecondOrDefault(b, "dayVoteSec", STATE.timerSettings.dayVoteSec)
                );
                STATE.timerSettings = t;
                if (b.has("publicDayVoteTally")) STATE.publicDayVoteTally = b.get("publicDayVoteTally").getAsBoolean();
                if (!"lobby".equals(STATE.phase) && !"game_over".equals(STATE.phase) && STATE.actionNoticeTitle == null) {
                    STATE.phaseEndsAt = System.currentTimeMillis() + (phaseDurationSec(STATE.phase) * 1000L);
                }
                writeJson(ex, 200, Map.of("ok", true, "timerSettings", t.toMap(), "publicDayVoteTally", STATE.publicDayVoteTally));
                return;
            }

            if ("POST".equals(method) && "/api/gm/start".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can start the game."));
                    return;
                }
                startGame(ex);
                return;
            }

            if ("POST".equals(method) && "/api/gm/start-night".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can advance phases."));
                    return;
                }
                if (!("night0".equals(STATE.phase) || "day_vote".equals(STATE.phase) || "discussion".equals(STATE.phase) || "morning".equals(STATE.phase) || "final_statements".equals(STATE.phase))) {
                    writeJson(ex, 400, Map.of("error", "Cannot start night from current phase."));
                    return;
                }
                beginNight();
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/gm/next-phase".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can advance phases."));
                    return;
                }
                nextPhaseInternal();
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/gm/void".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can void the game."));
                    return;
                }
                if ("lobby".equals(STATE.phase)) {
                    writeJson(ex, 400, Map.of("error", "No active game to void."));
                    return;
                }
                STATE.phase = "game_over";
                STATE.winner = "Voided";
                STATE.phaseEndsAt = 0L;
                STATE.scoresRecorded = true;
                pushPlayerChat("SYSTEM", "The GM voided this game. No scores were recorded.");
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase, "winner", STATE.winner));
                return;
            }

            if ("POST".equals(method) && "/api/gm/return-lobby".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can return to the lobby."));
                    return;
                }
                if (!"game_over".equals(STATE.phase)) {
                    writeJson(ex, 400, Map.of("error", "Return to lobby is only available after game over."));
                    return;
                }
                STATE.returnToLobbyKeepingSeats();
                writeJson(ex, 200, Map.of("ok", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/gm/reset".equals(path)) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can reset the lobby."));
                    return;
                }
                STATE.reset();
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("DELETE".equals(method) && path.startsWith("/api/gm/players/")) {
                Account account = requireAccount(ex);
                if (account == null) return;
                if (!canManageGame(account)) {
                    writeJson(ex, 403, Map.of("error", "Only an admin or room host can remove seats."));
                    return;
                }
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(ex, 400, Map.of("error", "Seats can only be removed before the game starts."));
                    return;
                }
                String playerId = path.substring("/api/gm/players/".length());
                boolean removed = STATE.players.removeIf(p -> p.id.equals(playerId));
                writeJson(ex, removed ? 200 : 404, removed ? Map.of("ok", true) : Map.of("error", "Player seat not found."));
                return;
            }

            if ("POST".equals(method) && "/api/player/mafia-vote".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(ex, b, "Mafia", "night_mafia");
                if (actor == null) return;
                String target = b.get("targetId").getAsString();
                if (!isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                String previous = STATE.mafiaVotes.get(actor.id);
                STATE.mafiaVotes.put(actor.id, target);
                Player voted = findPlayer(target);
                if (voted != null && !target.equals(previous)) pushMafiaChat("SYSTEM", actor.name + " voted for " + voted.name);
                int pending = Math.max(0, alivePlayersByRole("Mafia").size() - STATE.mafiaVotes.size());
                if (majorityTarget(STATE.mafiaVotes, alivePlayersByRole("Mafia").size()) != null) {
                    nextPhaseInternal();
                    writeJson(ex, 200, Map.of("ok", true, "locked", true, "phase", STATE.phase));
                    return;
                }
                writeJson(ex, 200, Map.of("ok", true, "pendingMafiaVotes", pending, "locked", false));
                return;
            }

            if ("POST".equals(method) && "/api/player/sheriff-investigate".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(ex, b, "Sheriff", "night_sheriff");
                if (actor == null) return;
                if (STATE.sheriffTarget != null) { writeJson(ex, 400, Map.of("error", "Sheriff investigation is already submitted.")); return; }
                String target = b.get("targetId").getAsString();
                Player t = findPlayer(target);
                if (t == null || !t.alive) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                STATE.sheriffTarget = target;
                actor.lastSheriffTargetName = t.name;
                actor.lastSheriffResult = "Mafia".equals(t.role) ? "Mafia" : "Town";
                STATE.lastSheriffResult = actor.name + " -> " + t.name + " is " + actor.lastSheriffResult;
                holdActionResult("Investigation submitted", actor.name + " investigated " + t.name + ": " + actor.lastSheriffResult + ". Advancing shortly.");
                writeJson(ex, 200, Map.of("ok", true, "locked", true, "hold", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/player/doctor-protect".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(ex, b, "Doctor", "night_doctor");
                if (actor == null) return;
                if (STATE.doctorTarget != null) { writeJson(ex, 400, Map.of("error", "Doctor protection is already submitted.")); return; }
                String target = b.get("targetId").getAsString();
                Player t = findPlayer(target);
                if (t == null || !t.alive) { writeJson(ex, 400, Map.of("error", "Target must be alive.")); return; }
                if (target.equals(actor.lastDoctorTarget)) { writeJson(ex, 400, Map.of("error", "Doctor cannot protect same target consecutively.")); return; }
                STATE.doctorTarget = target;
                holdActionResult("Protection submitted", actor.name + " protected " + t.name + ". Advancing shortly.");
                writeJson(ex, 200, Map.of("ok", true, "locked", true, "hold", true, "phase", STATE.phase));
                return;
            }

            if ("POST".equals(method) && "/api/player/vigilante-shoot".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(ex, b, "Vigilante", "night_vigilante");
                if (actor == null) return;
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
                Player actor = requireSessionPlayer(ex, b);
                if (actor == null) return;
                if (!actor.alive) { writeJson(ex, 400, Map.of("error", "Alive player required.")); return; }
                if (!"day_vote".equals(STATE.phase)) { writeJson(ex, 400, Map.of("error", "Not in day vote phase.")); return; }
                String target = b.has("targetId") && !b.get("targetId").isJsonNull() ? b.get("targetId").getAsString() : "";
                if (!target.isBlank() && !isAlivePlayer(target)) { writeJson(ex, 400, Map.of("error", "Target must be alive or abstain.")); return; }
                String stored = target.isBlank() ? null : target;
                String previous = STATE.dayVotes.get(actor.id);
                STATE.dayVotes.put(actor.id, stored);
                if (STATE.publicDayVoteTally && !Objects.equals(previous, stored)) {
                    String votedName = "abstain";
                    if (stored != null) {
                        Player voted = findPlayer(stored);
                        votedName = voted != null ? voted.name : stored;
                    }
                    pushPlayerChat("SYSTEM", actor.name + " voted for " + votedName);
                }
                int pending = Math.max(0, aliveCount() - STATE.dayVotes.size());
                if (majorityTarget(STATE.dayVotes, aliveCount()) != null || pending == 0) {
                    nextPhaseInternal();
                    writeJson(ex, 200, Map.of("ok", true, "locked", true, "phase", STATE.phase));
                    return;
                }
                writeJson(ex, 200, Map.of("ok", true, "pendingDayVotes", pending, "locked", false));
                return;
            }

            if ("POST".equals(method) && "/api/player/mafia-chat".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireAlivePlayer(ex, b, "Mafia", "night_mafia");
                if (actor == null) return;
                String msg = text(b, "message");
                if (msg.isBlank()) { writeJson(ex, 400, Map.of("error", "message required")); return; }
                pushMafiaChat(actor.name, limitMessage(msg));
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }

            if ("POST".equals(method) && "/api/player/chat".equals(path)) {
                JsonObject b = readBodyJson(ex);
                Player actor = requireSessionPlayer(ex, b);
                if (actor == null) return;
                String msg = text(b, "message");
                if (msg.isBlank()) { writeJson(ex, 400, Map.of("error", "message required")); return; }
                if ("final_statements".equals(STATE.phase)) {
                    if (!STATE.finalStatementPlayerIds.contains(actor.id)) {
                        writeJson(ex, 403, Map.of("error", "Only newly eliminated players may give a final statement."));
                        return;
                    }
                    if (STATE.finalStatements.containsKey(actor.id)) {
                        writeJson(ex, 409, Map.of("error", "Final statement already submitted."));
                        return;
                    }
                    String statement = limitMessage(msg);
                    STATE.finalStatements.put(actor.id, statement);
                    pushPlayerChat("FINAL " + actor.name, statement);
                    if (STATE.finalStatements.size() >= STATE.finalStatementPlayerIds.size()) nextPhaseInternal();
                    writeJson(ex, 200, Map.of("ok", true));
                    return;
                }
                if (!actor.alive) { writeJson(ex, 403, Map.of("error", "Dead players are observe-only.")); return; }
                if (!PUBLIC_CHAT_PHASES.contains(STATE.phase)) { writeJson(ex, 403, Map.of("error", "Public chat is available during morning, discussion, and voting.")); return; }
                pushPlayerChat(actor.name, limitMessage(msg));
                writeJson(ex, 200, Map.of("ok", true));
                return;
            }
        }

        writeJson(ex, 404, Map.of("error", "API route not found."));
    }

    private static void startGame(HttpExchange ex) throws IOException {
        if (!"lobby".equals(STATE.phase)) {
            writeJson(ex, 409, Map.of("error", "Game already started."));
            return;
        }
        if (STATE.players.size() < 3) {
            writeJson(ex, 400, Map.of("error", "Need at least 3 players to start."));
            return;
        }
        if (!hasMinimumTestRoles(STATE.config)) {
            writeJson(ex, 400, Map.of("error", "Start requires at least 1 Mafia, 1 Town, and 1 Sheriff/Doctor/Vigilante."));
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
            p.lastSheriffTargetName = null;
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
        STATE.finalStatementPlayerIds = new ArrayList<>();
        STATE.finalStatements = new LinkedHashMap<>();
        for (Player p : STATE.players) {
            if ("Sheriff".equals(p.role)) {
                p.lastSheriffResult = null;
                p.lastSheriffTargetName = null;
            }
        }
        setPhase("night_mafia");
    }

    private static void nextPhaseInternal() {
        if ("game_over".equals(STATE.phase)) return;
        switch (STATE.phase) {
            case "night0" -> beginNight();
            case "night_mafia", "night_sheriff", "night_doctor", "night_vigilante" -> advanceNightRolePhase();
            case "morning" -> {
                STATE.afterFinalStatementsPhase = "discussion";
                if (!STATE.finalStatementPlayerIds.isEmpty()) setPhase("final_statements");
                else setPhase("discussion");
            }
            case "final_statements" -> {
                if ("night".equals(STATE.afterFinalStatementsPhase)) beginNight();
                else setPhase("discussion");
            }
            case "discussion" -> setPhase("day_vote");
            case "day_vote" -> {
                resolveDayVote();
                checkWin();
                if (!"game_over".equals(STATE.phase)) {
                    STATE.afterFinalStatementsPhase = "night";
                    if (!STATE.finalStatementPlayerIds.isEmpty()) setPhase("final_statements");
                    else beginNight();
                }
            }
        }
    }

    private static void advanceNightRolePhase() {
        String next = GameRules.nextNightRolePhase(
                STATE.phase,
                aliveRoleExists("Sheriff"),
                aliveRoleExists("Doctor"),
                aliveRoleExists("Vigilante")
        );
        if (next == null) endNightAndEnterMorning();
        else setPhase(next);
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
                addDeathForAnnouncement(p);
            }
        }
    }

    private static void resolveDayVote() {
        String target = majorityTarget(STATE.dayVotes, aliveCount());
        if (target != null) {
            Player p = findPlayer(target);
            if (p != null && p.alive) {
                p.alive = false;
        STATE.morningDeaths = new ArrayList<>();
        STATE.finalStatementPlayerIds = new ArrayList<>();
        STATE.finalStatements = new LinkedHashMap<>();
        STATE.afterFinalStatementsPhase = "discussion";
                addDeathForAnnouncement(p);
            }
        } else {
            STATE.morningDeaths = new ArrayList<>();
            STATE.finalStatementPlayerIds = new ArrayList<>();
            STATE.finalStatements = new LinkedHashMap<>();
        }
    }

    private static void addDeathForAnnouncement(Player p) {
        STATE.morningDeaths.add(Map.of("id", p.id, "name", p.name, "role", p.role));
        if (!STATE.finalStatementPlayerIds.contains(p.id)) STATE.finalStatementPlayerIds.add(p.id);
    }

    private static void checkWin() {
        long mafiaAlive = alivePlayersByRole("Mafia").size();
        long townAlive = STATE.players.stream().filter(p -> p.alive && !"Mafia".equals(p.role)).count();
        String winner = GameRules.winnerFor(mafiaAlive, townAlive, STATE.players.stream().anyMatch(p -> p.role != null));
        if (winner != null) {
            STATE.phase = "game_over";
            STATE.winner = winner;
            STATE.phaseEndsAt = 0;
            recordScores(winner);
        }
    }

    private static void recordScores(String winner) {
        if (STATE.scoresRecorded) return;
        for (Player p : STATE.players) {
            Account a = DB.findAccount(p.accountId);
            if (a == null || p.role == null) continue;
            boolean won = ("Mafia".equals(p.role) && "Mafia".equals(winner)) || (!"Mafia".equals(p.role) && "Town".equals(winner));
            a.scoreGames += 1;
            if (won) a.scoreWins += 1;
            else a.scoreLosses += 1;
        }
        STATE.scoresRecorded = true;
        DB.save();
    }

    private static Account requireAccount(HttpExchange ex) throws IOException {
        String token = sessionToken(ex);
        Session session = token == null ? null : DB.data.sessions.get(token);
        Account account = session == null ? null : DB.findAccount(session.accountId);
        if (account == null) {
            writeJson(ex, 401, Map.of("error", "Login required."));
            return null;
        }
        session.lastSeenAt = Instant.now().toString();
        return account;
    }

    private static Account requireAdmin(HttpExchange ex) throws IOException {
        Account account = requireAccount(ex);
        if (account == null) return null;
        if (!account.isAdmin) {
            writeJson(ex, 403, Map.of("error", "Admin access required."));
            return null;
        }
        return account;
    }

    private static Player requireSessionPlayer(HttpExchange ex, JsonObject body) throws IOException {
        Account account = requireAccount(ex);
        if (account == null) return null;
        String pid = body.has("playerId") ? body.get("playerId").getAsString() : "";
        Player p = findPlayer(pid);
        if (p == null || !account.id.equals(p.accountId)) {
            writeJson(ex, 403, Map.of("error", "Player session mismatch."));
            return null;
        }
        return p;
    }

    private static Player requireAlivePlayer(HttpExchange ex, JsonObject body, String role, String phase) throws IOException {
        Player p = requireSessionPlayer(ex, body);
        if (p == null) return null;
        if (!p.alive) { writeJson(ex, 400, Map.of("error", "Alive player required.")); return null; }
        if (!role.equals(p.role)) { writeJson(ex, 400, Map.of("error", "Role mismatch.")); return null; }
        if (!phase.equals(STATE.phase)) { writeJson(ex, 400, Map.of("error", "Wrong phase.")); return null; }
        return p;
    }

    private static boolean canManageGame(Account account) {
        if (account.isAdmin) return true;
        Room room = DB.defaultRoom();
        return room != null && account.id.equals(room.hostAccountId);
    }

    private static void startPhaseTicker() {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "mafia-phase-ticker");
            t.setDaemon(true);
            return t;
        });
        scheduler.scheduleAtFixedRate(() -> {
            synchronized (LOCK) {
                tickPhaseTransitions();
            }
        }, 500, 500, TimeUnit.MILLISECONDS);
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
            case "night0", "night_mafia" -> STATE.timerSettings.nightMafiaSec;
            case "night_sheriff" -> STATE.timerSettings.nightSheriffSec;
            case "night_doctor" -> STATE.timerSettings.nightDoctorSec;
            case "night_vigilante" -> STATE.timerSettings.nightVigilanteSec;
            case "morning" -> STATE.timerSettings.morningSec;
            case "final_statements" -> STATE.timerSettings.finalStatementSec;
            case "discussion" -> STATE.timerSettings.discussionSec;
            case "day_vote" -> STATE.timerSettings.dayVoteSec;
            default -> 0;
        };
    }

    private static void setPhase(String phase) {
        if (!Objects.equals(STATE.phase, phase)) clearActionNotice();
        STATE.phase = phase;
        int sec = phaseDurationSec(phase);
        STATE.phaseEndsAt = sec > 0 ? System.currentTimeMillis() + sec * 1000L : 0L;
    }

    private static void holdActionResult(String title, String body) {
        STATE.actionNoticeTitle = title;
        STATE.actionNoticeBody = body;
        STATE.phaseEndsAt = System.currentTimeMillis() + ACTION_RESULT_HOLD_MS;
    }

    private static void clearActionNotice() {
        STATE.actionNoticeTitle = null;
        STATE.actionNoticeBody = null;
    }

    private static Map<String, Object> gmStatePayload(Account account) {
        boolean manager = canManageGame(account);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("phase", STATE.phase);
        payload.put("round", STATE.round);
        payload.put("nightStep", STATE.nightStep);
        payload.put("phaseRemainingSec", phaseRemainingSec());
        payload.put("players", STATE.players.stream().map(p -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", p.id);
            row.put("accountId", p.accountId);
            row.put("name", p.name);
            row.put("alive", p.alive);
            row.put("role", manager ? p.role : (p.alive ? null : p.role));
            Account a = DB.findAccount(p.accountId);
            row.put("avatarDataUrl", a == null ? "" : a.avatarDataUrl);
            return row;
        }).toList());
        payload.put("playerCount", STATE.players.size());
        payload.put("aliveCount", aliveCount());
        payload.put("config", STATE.config.toMap());
        payload.put("timerSettings", STATE.timerSettings.toMap());
        payload.put("expectedRoleTotal", rolePool(STATE.config).size());
        payload.put("morningDeaths", STATE.morningDeaths);
        payload.put("finalStatements", STATE.finalStatements);
        payload.put("finalStatementPending", Math.max(0, STATE.finalStatementPlayerIds.size() - STATE.finalStatements.size()));
        payload.put("winner", STATE.winner);
        payload.put("lastSheriffResult", manager ? STATE.lastSheriffResult : "");
        payload.put("mafiaVoteTally", manager ? tally(STATE.mafiaVotes) : Map.of());
        payload.put("dayVoteTally", manager || STATE.publicDayVoteTally ? tally(STATE.dayVotes) : Map.of());
        payload.put("pendingMafiaVotes", manager ? Math.max(0, alivePlayersByRole("Mafia").size() - STATE.mafiaVotes.size()) : 0);
        payload.put("pendingDayVotes", manager ? Math.max(0, aliveCount() - STATE.dayVotes.size()) : 0);
        payload.put("currentActionName", manager ? currentActionName() : "");
        payload.put("pendingActionPlayers", manager ? pendingActionPlayerNames() : List.of());
        payload.put("actionNoticeTitle", manager ? nullToEmpty(STATE.actionNoticeTitle) : "");
        payload.put("actionNoticeBody", manager ? nullToEmpty(STATE.actionNoticeBody) : "");
        payload.put("publicDayVoteTally", STATE.publicDayVoteTally);
        payload.put("mafiaChat", manager ? chatPayload(STATE.mafiaChat) : List.of());
        payload.put("playerChat", manager ? chatPayload(STATE.playerChat) : List.of());
        payload.put("canManage", manager);
        payload.put("room", roomPayload(DB.defaultRoom()));
        return payload;
    }

    private static Map<String, Object> playerStatePayload(Player p, Account account) {
        boolean mafia = "Mafia".equals(p.role);
        boolean sheriff = "Sheriff".equals(p.role);
        boolean doctor = "Doctor".equals(p.role);
        boolean vigilante = "Vigilante".equals(p.role);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", p.id);
        payload.put("name", p.name);
        payload.put("phase", STATE.phase);
        payload.put("round", STATE.round);
        payload.put("alive", p.alive);
        payload.put("phaseRemainingSec", phaseRemainingSec());
        payload.put("role", "lobby".equals(STATE.phase) ? null : p.role);
        payload.put("roleDescription", roleDescription(p.role));
        payload.put("vigilanteShotsRemaining", vigilante ? p.vigilanteShotsRemaining : 0);
        payload.put("sheriffResult", sheriff ? p.lastSheriffResult : null);
        payload.put("sheriffResultTargetName", sheriff ? p.lastSheriffTargetName : null);
        payload.put("lastDoctorTarget", doctor ? p.lastDoctorTarget : null);
        payload.put("actionNoticeTitle", roleCanSeeActionNotice(p.role) ? nullToEmpty(STATE.actionNoticeTitle) : "");
        payload.put("actionNoticeBody", roleCanSeeActionNotice(p.role) ? playerActionNoticeBody(p) : "");
        payload.put("players", STATE.players.stream().map(other -> {
            Account a = DB.findAccount(other.accountId);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", other.id);
            row.put("name", other.name);
            row.put("alive", other.alive);
            row.put("revealedRole", other.alive ? null : other.role);
            row.put("avatarDataUrl", a == null ? "" : a.avatarDataUrl);
            return row;
        }).toList());
        boolean observer = !p.alive || "game_over".equals(STATE.phase);
        payload.put("observerPlayers", observer
                ? STATE.players.stream().map(other -> {
                    Account a = DB.findAccount(other.accountId);
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", other.id);
                    row.put("accountId", other.accountId);
                    row.put("name", other.name);
                    row.put("alive", other.alive);
                    row.put("role", other.role);
                    row.put("avatarDataUrl", a == null ? "" : a.avatarDataUrl);
                    return row;
                }).toList()
                : List.of());
        payload.put("observerCurrentActionName", observer ? currentActionName() : "");
        payload.put("observerPendingActionPlayers", observer ? pendingActionPlayerNames() : List.of());
        payload.put("observerActionNoticeTitle", observer ? nullToEmpty(STATE.actionNoticeTitle) : "");
        payload.put("observerActionNoticeBody", observer ? nullToEmpty(STATE.actionNoticeBody) : "");
        payload.put("observerLastSheriffResult", observer ? nullToEmpty(STATE.lastSheriffResult) : "");
        payload.put("observerMafiaVoteTally", observer ? tally(STATE.mafiaVotes) : Map.of());
        payload.put("observerDayVoteTally", observer ? tally(STATE.dayVotes) : Map.of());
        payload.put("morningDeaths", STATE.morningDeaths);
        payload.put("finalStatements", STATE.finalStatements);
        payload.put("finalStatementEligible", STATE.finalStatementPlayerIds.contains(p.id));
        payload.put("finalStatementSubmitted", STATE.finalStatements.containsKey(p.id));
        payload.put("winner", STATE.winner);
        payload.put("mafiaVoteCurrent", mafia ? STATE.mafiaVotes.get(p.id) : null);
        payload.put("sheriffTargetCurrent", sheriff ? STATE.sheriffTarget : null);
        payload.put("doctorProtectCurrent", doctor ? STATE.doctorTarget : null);
        payload.put("vigilanteTargetCurrent", vigilante ? STATE.vigilanteTarget : null);
        payload.put("dayVoteCurrent", STATE.dayVotes.get(p.id));
        payload.put("mafiaVoteSubmitted", mafia && STATE.mafiaVotes.containsKey(p.id));
        payload.put("dayVoteSubmitted", STATE.dayVotes.containsKey(p.id));
        payload.put("pendingMafiaVotes", mafia ? Math.max(0, alivePlayersByRole("Mafia").size() - STATE.mafiaVotes.size()) : 0);
        payload.put("pendingDayVotes", "day_vote".equals(STATE.phase) ? Math.max(0, aliveCount() - STATE.dayVotes.size()) : 0);
        payload.put("publicDayVoteTally", STATE.publicDayVoteTally);
        payload.put("timerSettings", STATE.timerSettings.toMap());
        payload.put("room", roomPayload(DB.defaultRoom()));
        payload.put("account", accountPayload(account));
        payload.put("mafiaChat", mafia && p.alive && "night_mafia".equals(STATE.phase) ? chatPayload(STATE.mafiaChat) : List.of());
        payload.put("mafiaTeam", mafia
                ? STATE.players.stream()
                        .filter(other -> "Mafia".equals(other.role))
                        .map(other -> {
                            Map<String, Object> row = new LinkedHashMap<>();
                            row.put("id", other.id);
                            row.put("name", other.name);
                            row.put("alive", other.alive);
                            return row;
                        })
                        .toList()
                : List.of());
        payload.put("playerChat", PUBLIC_CHAT_VISIBLE_PHASES.contains(STATE.phase) ? chatPayload(STATE.playerChat) : List.of());
        payload.put("publicChatCanSend", p.alive && PUBLIC_CHAT_PHASES.contains(STATE.phase));
        payload.put("publicChatVisible", PUBLIC_CHAT_VISIBLE_PHASES.contains(STATE.phase));
        return payload;
    }

    private static Map<String, Object> accountPayload(Account a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.id);
        m.put("email", a.email);
        m.put("username", a.username);
        m.put("displayName", a.displayName);
        m.put("isAdmin", a.isAdmin);
        m.put("avatarDataUrl", a.avatarDataUrl == null ? "" : a.avatarDataUrl);
        m.put("scores", Map.of("games", a.scoreGames, "wins", a.scoreWins, "losses", a.scoreLosses));
        return m;
    }

    private static Map<String, Object> adminAccountPayload(Account a) {
        Map<String, Object> m = accountPayload(a);
        m.put("createdAt", a.createdAt);
        return m;
    }

    private static Map<String, Object> roomPayload(Room r) {
        if (r == null) return Map.of();
        return Map.of(
                "id", r.id,
                "name", r.name,
                "networkMode", r.networkMode,
                "hostAccountId", r.hostAccountId,
                "active", r.id.equals(DB.data.activeRoomId),
                "createdAt", r.createdAt,
                "lastActiveAt", r.lastActiveAt
        );
    }

    private static void writeJson(HttpExchange ex, int status, Object data) throws IOException {
        byte[] bytes = GSON.toJson(data).getBytes(StandardCharsets.UTF_8);
        Headers h = ex.getResponseHeaders();
        h.set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) { out.write(bytes); }
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
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".gif")) return "image/gif";
        return "text/plain; charset=utf-8";
    }

    private static void addSecurityHeaders(HttpExchange ex) {
        Headers h = ex.getResponseHeaders();
        h.set("X-Content-Type-Options", "nosniff");
        h.set("Referrer-Policy", "same-origin");
    }

    private static String text(JsonObject body, String key) {
        if (!body.has(key) || body.get(key).isJsonNull()) return "";
        return body.get(key).getAsString().trim();
    }

    private static String validateRegistration(String email, String username, String password) {
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) return "Email is not valid.";
        if (!username.matches("^[A-Za-z0-9_.-]{3,24}$")) return "Username must be 3-24 letters, numbers, dots, dashes, or underscores.";
        if (password.length() < 6 || password.length() > 128) return "Password must be 6-128 characters.";
        return null;
    }

    private static String validateAvatar(String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) return null;
        if (dataUrl.length() > 180_000) return "Profile image is too large.";
        if (!dataUrl.matches("^data:image/(png|jpeg|jpg|gif);base64,.+")) return "Profile image must be png, jpg, jpeg, or gif.";
        try {
            String base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
            byte[] bytes = Base64.getDecoder().decode(base64);
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null) return "Profile image could not be read.";
            if (image.getWidth() > 100 || image.getHeight() > 100) return "Profile image must be max 100x100 pixels.";
            return null;
        } catch (Exception err) {
            return "Profile image could not be decoded.";
        }
    }

    private static String limitMessage(String msg) {
        return msg.length() <= 240 ? msg : msg.substring(0, 240);
    }

    private static String sessionToken(HttpExchange ex) {
        List<String> cookies = ex.getRequestHeaders().getOrDefault("Cookie", List.of());
        for (String header : cookies) {
            for (String part : header.split(";")) {
                String[] kv = part.trim().split("=", 2);
                if (kv.length == 2 && "mafia_session".equals(kv[0])) return kv[1];
            }
        }
        return null;
    }

    private static void setSessionCookie(HttpExchange ex, String token) {
        ex.getResponseHeaders().add("Set-Cookie", "mafia_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000");
    }

    private static void clearSessionCookie(HttpExchange ex) {
        ex.getResponseHeaders().add("Set-Cookie", "mafia_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    }

    private static void syncPlayerName(Account account) {
        for (Player p : STATE.players) {
            if (account.id.equals(p.accountId)) p.name = account.displayName;
        }
    }

    private static void pushMafiaChat(String author, String msg) {
        STATE.mafiaChat.add(new ChatMessage(author, msg));
        if (STATE.mafiaChat.size() > 50) STATE.mafiaChat.remove(0);
    }

    private static void pushPlayerChat(String author, String msg) {
        STATE.playerChat.add(new ChatMessage(author, msg));
        if (STATE.playerChat.size() > 120) STATE.playerChat.remove(0);
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

    private static List<Map<String, String>> chatPayload(List<ChatMessage> chat) {
        return chat.stream().map(m -> Map.of("author", m.author, "message", m.message)).toList();
    }

    private static String majorityTarget(Map<String, String> voteMap, int voterCount) {
        return GameRules.majorityTarget(voteMap, voterCount);
    }

    private static String pluralityTarget(Map<String, String> voteMap) {
        return GameRules.pluralityTarget(voteMap);
    }

    private static String currentActionName() {
        return switch (STATE.phase) {
            case "night0" -> "Role reveal";
            case "night_mafia" -> "Mafia vote";
            case "night_sheriff" -> "Sheriff investigation";
            case "night_doctor" -> "Doctor protection";
            case "night_vigilante" -> "Vigilante choice";
            case "final_statements" -> "Final statements";
            case "day_vote" -> "Day vote";
            default -> "";
        };
    }

    private static boolean roleCanSeeActionNotice(String role) {
        return ("night_sheriff".equals(STATE.phase) && "Sheriff".equals(role) && STATE.sheriffTarget != null)
                || ("night_doctor".equals(STATE.phase) && "Doctor".equals(role) && STATE.doctorTarget != null);
    }

    private static String playerActionNoticeBody(Player p) {
        if ("night_sheriff".equals(STATE.phase) && "Sheriff".equals(p.role) && p.lastSheriffResult != null) {
            return "Your result is visible below. The table will advance shortly.";
        }
        if ("night_doctor".equals(STATE.phase) && "Doctor".equals(p.role) && STATE.doctorTarget != null) {
            return "Your protection is locked in. The table will advance shortly.";
        }
        return "";
    }

    private static List<String> pendingActionPlayerNames() {
        return switch (STATE.phase) {
            case "night_mafia" -> alivePlayersByRole("Mafia").stream()
                    .filter(p -> !STATE.mafiaVotes.containsKey(p.id))
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            case "night_sheriff" -> alivePlayersByRole("Sheriff").stream()
                    .filter(p -> STATE.sheriffTarget == null)
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            case "night_doctor" -> alivePlayersByRole("Doctor").stream()
                    .filter(p -> STATE.doctorTarget == null)
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            case "night_vigilante" -> alivePlayersByRole("Vigilante").stream()
                    .filter(p -> STATE.vigilanteTarget == null)
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            case "final_statements" -> STATE.finalStatementPlayerIds.stream()
                    .filter(id -> !STATE.finalStatements.containsKey(id))
                    .map(Main::findPlayer)
                    .filter(Objects::nonNull)
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            case "day_vote" -> STATE.players.stream()
                    .filter(p -> p.alive && !STATE.dayVotes.containsKey(p.id))
                    .map(p -> p.name)
                    .collect(Collectors.toList());
            default -> List.of();
        };
    }

    private static boolean aliveRoleExists(String role) { return aliveByRole(role) != null; }
    private static Player aliveByRole(String role) { return STATE.players.stream().filter(p -> p.alive && role.equals(p.role)).findFirst().orElse(null); }
    private static List<Player> alivePlayersByRole(String role) { return STATE.players.stream().filter(p -> p.alive && role.equals(p.role)).collect(Collectors.toList()); }
    private static int aliveCount() { return (int) STATE.players.stream().filter(p -> p.alive).count(); }
    private static boolean isAlivePlayer(String id) { Player p = findPlayer(id); return p != null && p.alive; }
    private static Player findPlayer(String id) { return STATE.players.stream().filter(p -> p.id.equals(id)).findFirst().orElse(null); }
    private static Player findPlayerByAccount(String accountId) { return STATE.players.stream().filter(p -> accountId.equals(p.accountId)).findFirst().orElse(null); }
    private static boolean hasMinimumTestRoles(RoleConfig cfg) { return cfg.mafia >= 1 && (cfg.sheriff + cfg.doctor + cfg.vigilante) >= 1 && cfg.town >= 1; }
    private static int intValue(JsonObject body, String key) { return body.has(key) ? body.get(key).getAsInt() : -1; }
    private static int positiveSecondOrDefault(JsonObject body, String key, int fallback) { return body.has(key) ? Math.max(1, body.get(key).getAsInt()) : fallback; }
    private static String nullToEmpty(String value) { return value == null ? "" : value; }

    private static List<String> rolePool(RoleConfig cfg) {
        List<String> pool = new ArrayList<>();
        for (int i = 0; i < cfg.mafia; i++) pool.add("Mafia");
        for (int i = 0; i < cfg.sheriff; i++) pool.add("Sheriff");
        for (int i = 0; i < cfg.doctor; i++) pool.add("Doctor");
        for (int i = 0; i < cfg.vigilante; i++) pool.add("Vigilante");
        for (int i = 0; i < cfg.town; i++) pool.add("Town");
        return pool;
    }

    private static String roleDescription(String role) {
        return switch (role == null ? "" : role) {
            case "Mafia" -> "Eliminate town each night with your team.";
            case "Sheriff" -> "Investigate one player each night.";
            case "Doctor" -> "Protect one player each night. You cannot repeat the same target on consecutive nights.";
            case "Vigilante" -> "Use limited night shots to remove a suspect, or skip.";
            case "Town" -> "Read the table, argue well, and vote out the mafia.";
            default -> "";
        };
    }

    private static String generateSessionId(String name) {
        String safe = name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        if (safe.isBlank()) safe = "player";
        int rand = ThreadLocalRandom.current().nextInt(1000, 10_000);
        return safe + "-" + rand;
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

    private static String hashPassword(String password, String salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), Base64.getDecoder().decode(salt), 120_000, 256);
            byte[] hash = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception err) {
            throw new IllegalStateException("Password hashing failed.", err);
        }
    }

    private static boolean verifyPassword(String password, String salt, String expectedHash) {
        return MessageDigest.isEqual(hashPassword(password, salt).getBytes(StandardCharsets.UTF_8), expectedHash.getBytes(StandardCharsets.UTF_8));
    }

    private static String newSalt() {
        byte[] salt = new byte[16];
        RNG.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }

    private static final class LocalDatabase {
        final Path path;
        DatabaseData data = new DatabaseData();

        LocalDatabase(Path path) { this.path = path; }

        void load() {
            try {
                if (Files.exists(path)) {
                    data = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), DatabaseData.class);
                    if (data == null) data = new DatabaseData();
                    if (data.accounts == null) data.accounts = new ArrayList<>();
                    if (data.rooms == null) data.rooms = new ArrayList<>();
                    if (data.sessions == null) data.sessions = new HashMap<>();
                    if (data.activeRoomId == null || data.activeRoomId.isBlank()) {
                        data.activeRoomId = data.rooms.isEmpty() ? "" : data.rooms.get(0).id;
                    }
                }
            } catch (Exception err) {
                throw new IllegalStateException("Could not load local database.", err);
            }
        }

        void save() {
            try {
                Files.createDirectories(path.getParent());
                Files.writeString(path, GSON.toJson(data), StandardCharsets.UTF_8);
            } catch (IOException err) {
                throw new IllegalStateException("Could not save local database.", err);
            }
        }

        void seedAdmin() {
            Account admin = findAccountByLogin(ADMIN_EMAIL);
            if (admin == null) admin = findAccountByLogin(ADMIN_USERNAME);
            if (admin == null) {
                data.accounts.add(Account.create(ADMIN_EMAIL, ADMIN_USERNAME, "Gabi Admin", ADMIN_PASSWORD, true));
                return;
            }
            admin.email = ADMIN_EMAIL;
            admin.username = ADMIN_USERNAME;
            admin.displayName = admin.displayName == null || admin.displayName.isBlank() ? "Gabi Admin" : admin.displayName;
            admin.isAdmin = true;
            admin.setPassword(ADMIN_PASSWORD);
        }

        void ensureDefaultRoom() {
            if (data.rooms.isEmpty()) {
                Account admin = findAccountByLogin(ADMIN_USERNAME);
                Room room = Room.create("Table One", admin == null ? "" : admin.id, "local");
                data.rooms.add(room);
                data.activeRoomId = room.id;
            } else if (data.activeRoomId == null || findRoom(data.activeRoomId) == null) {
                data.activeRoomId = data.rooms.get(0).id;
            }
        }

        Room defaultRoom() {
            ensureDefaultRoom();
            Room active = findRoom(data.activeRoomId);
            return active == null ? data.rooms.get(0) : active;
        }

        Account findAccount(String id) {
            return data.accounts.stream().filter(a -> a.id.equals(id)).findFirst().orElse(null);
        }

        Account findAccountByLogin(String login) {
            String normalized = login == null ? "" : login.trim().toLowerCase();
            return data.accounts.stream()
                    .filter(a -> a.email.equalsIgnoreCase(normalized) || a.username.equalsIgnoreCase(normalized))
                    .findFirst()
                    .orElse(null);
        }

        long adminCount() {
            return data.accounts.stream().filter(a -> a.isAdmin).count();
        }

        Room findRoom(String id) {
            return data.rooms.stream().filter(r -> r.id.equals(id)).findFirst().orElse(null);
        }

        String createSession(String accountId) {
            String token = UUID.randomUUID() + "-" + UUID.randomUUID();
            data.sessions.put(token, new Session(accountId));
            return token;
        }
    }

    private static final class DatabaseData {
        List<Account> accounts = new ArrayList<>();
        List<Room> rooms = new ArrayList<>();
        Map<String, Session> sessions = new HashMap<>();
        String activeRoomId = "";
    }

    private static final class Account {
        String id, email, username, displayName, salt, passwordHash, avatarDataUrl, createdAt;
        boolean isAdmin;
        int scoreGames, scoreWins, scoreLosses;

        static Account create(String email, String username, String displayName, String password, boolean admin) {
            Account a = new Account();
            a.id = UUID.randomUUID().toString();
            a.email = email;
            a.username = username;
            a.displayName = displayName;
            a.createdAt = Instant.now().toString();
            a.avatarDataUrl = "";
            a.isAdmin = admin;
            a.setPassword(password);
            return a;
        }

        void setPassword(String password) {
            salt = newSalt();
            passwordHash = hashPassword(password, salt);
        }
    }

    private static final class Session {
        String accountId, createdAt, lastSeenAt;
        Session(String accountId) {
            this.accountId = accountId;
            createdAt = Instant.now().toString();
            lastSeenAt = createdAt;
        }
    }

    private static final class Room {
        String id, name, hostAccountId, networkMode, createdAt, lastActiveAt;
        static Room create(String name, String hostAccountId, String mode) {
            Room r = new Room();
            r.id = UUID.randomUUID().toString();
            r.name = name;
            r.hostAccountId = hostAccountId;
            r.networkMode = "internet".equalsIgnoreCase(mode) ? "internet" : "local";
            r.createdAt = Instant.now().toString();
            r.lastActiveAt = r.createdAt;
            return r;
        }
    }

    private static final class GameState {
        String phase = "lobby";
        String nightStep = "-";
        int round = 0;
        String winner = null;
        String lastSheriffResult = null;
        String actionNoticeTitle = null;
        String actionNoticeBody = null;
        long phaseEndsAt = 0L;
        boolean scoresRecorded = false;

        List<Player> players = new ArrayList<>();
        RoleConfig config = new RoleConfig(2, 1, 1, 0, 1, 1);
        TimerSettings timerSettings = new TimerSettings(60, 60, 60, 60, 60, 45, 60, 60);

        Map<String, String> mafiaVotes = new HashMap<>();
        String sheriffTarget = null;
        String doctorTarget = null;
        String vigilanteTarget = null;
        Map<String, String> dayVotes = new HashMap<>();

        List<Map<String, String>> morningDeaths = new ArrayList<>();
        List<String> finalStatementPlayerIds = new ArrayList<>();
        Map<String, String> finalStatements = new LinkedHashMap<>();
        String afterFinalStatementsPhase = "discussion";
        List<ChatMessage> mafiaChat = new ArrayList<>();
        List<ChatMessage> playerChat = new ArrayList<>();
        boolean publicDayVoteTally = true;

        void reset() {
            phase = "lobby";
            nightStep = "-";
            round = 0;
            winner = null;
            lastSheriffResult = null;
            actionNoticeTitle = null;
            actionNoticeBody = null;
            phaseEndsAt = 0L;
            scoresRecorded = false;
            players = new ArrayList<>();
            config = new RoleConfig(2, 1, 1, 0, 1, 1);
            timerSettings = new TimerSettings(60, 60, 60, 60, 60, 45, 60, 60);
            mafiaVotes = new HashMap<>();
            sheriffTarget = null;
            doctorTarget = null;
            vigilanteTarget = null;
            dayVotes = new HashMap<>();
            morningDeaths = new ArrayList<>();
            finalStatementPlayerIds = new ArrayList<>();
            finalStatements = new LinkedHashMap<>();
            afterFinalStatementsPhase = "discussion";
            mafiaChat = new ArrayList<>();
            playerChat = new ArrayList<>();
            publicDayVoteTally = true;
        }

        void returnToLobbyKeepingSeats() {
            phase = "lobby";
            nightStep = "-";
            round = 0;
            winner = null;
            lastSheriffResult = null;
            actionNoticeTitle = null;
            actionNoticeBody = null;
            phaseEndsAt = 0L;
            scoresRecorded = false;
            mafiaVotes = new HashMap<>();
            sheriffTarget = null;
            doctorTarget = null;
            vigilanteTarget = null;
            dayVotes = new HashMap<>();
            morningDeaths = new ArrayList<>();
            finalStatementPlayerIds = new ArrayList<>();
            finalStatements = new LinkedHashMap<>();
            afterFinalStatementsPhase = "discussion";
            mafiaChat = new ArrayList<>();
            playerChat = new ArrayList<>();
            for (Player p : players) {
                p.role = null;
                p.alive = true;
                p.lastDoctorTarget = null;
                p.lastSheriffResult = null;
                p.lastSheriffTargetName = null;
                p.vigilanteShotsRemaining = 0;
            }
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
        int nightMafiaSec, nightSheriffSec, nightDoctorSec, nightVigilanteSec, morningSec, finalStatementSec, discussionSec, dayVoteSec;
        TimerSettings(int nightMafiaSec, int nightSheriffSec, int nightDoctorSec, int nightVigilanteSec, int morningSec, int finalStatementSec, int discussionSec, int dayVoteSec) {
            this.nightMafiaSec = nightMafiaSec;
            this.nightSheriffSec = nightSheriffSec;
            this.nightDoctorSec = nightDoctorSec;
            this.nightVigilanteSec = nightVigilanteSec;
            this.morningSec = morningSec;
            this.finalStatementSec = finalStatementSec;
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
            m.put("finalStatementSec", finalStatementSec);
            m.put("discussionSec", discussionSec);
            m.put("dayVoteSec", dayVoteSec);
            return m;
        }
    }

    private static final class Player {
        String id, accountId, roomId, name, role;
        boolean alive;
        String lastDoctorTarget;
        String lastSheriffResult;
        String lastSheriffTargetName;
        int vigilanteShotsRemaining;
        Player(String id, String accountId, String name) {
            this.id = id;
            this.accountId = accountId;
            this.name = name;
            this.alive = true;
            this.role = null;
            this.lastDoctorTarget = null;
            this.lastSheriffResult = null;
            this.lastSheriffTargetName = null;
            this.vigilanteShotsRemaining = 0;
        }
    }

    private static final class ChatMessage {
        String author, message;
        ChatMessage(String author, String message) { this.author = author; this.message = message; }
    }
}
