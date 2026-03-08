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
import java.util.UUID;

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
        for (String url : getLanUrls(port)) {
            System.out.println("LAN access: " + url);
        }
    }

    private static void handleRequest(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            if (path.startsWith("/api/")) {
                handleApi(exchange, path);
                return;
            }
            serveStatic(exchange, path);
        } catch (Exception ex) {
            Map<String, String> error = Map.of("error", "Internal server error: " + ex.getMessage());
            writeJson(exchange, 500, error);
        } finally {
            exchange.close();
        }
    }

    private static void handleApi(HttpExchange exchange, String path) throws IOException {
        String method = exchange.getRequestMethod();

        if ("GET".equals(method) && "/api/server-info".equals(path)) {
            int port = exchange.getLocalAddress().getPort();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("port", port);
            data.put("localhost", "http://localhost:" + port);
            data.put("lanUrls", getLanUrls(port));
            writeJson(exchange, 200, data);
            return;
        }

        if ("GET".equals(method) && "/api/gm-state".equals(path)) {
            synchronized (LOCK) {
                writeJson(exchange, 200, gmStatePayload());
            }
            return;
        }

        if ("POST".equals(method) && "/api/join".equals(path)) {
            JsonObject body = readBodyJson(exchange);
            String name = body.has("name") ? body.get("name").getAsString().trim() : "";
            synchronized (LOCK) {
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(exchange, 409, Map.of("error", "Game already started."));
                    return;
                }
                if (name.isBlank()) {
                    writeJson(exchange, 400, Map.of("error", "Name is required."));
                    return;
                }
                if (name.length() > 24) {
                    writeJson(exchange, 400, Map.of("error", "Name max length is 24."));
                    return;
                }
                Player p = new Player(UUID.randomUUID().toString(), name);
                STATE.players.add(p);
                writeJson(exchange, 201, Map.of("playerId", p.id));
            }
            return;
        }

        if ("GET".equals(method) && path.startsWith("/api/player-state/")) {
            String id = path.substring("/api/player-state/".length());
            synchronized (LOCK) {
                Player player = findPlayer(id);
                if (player == null) {
                    writeJson(exchange, 404, Map.of("error", "Player not found."));
                    return;
                }
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("id", player.id);
                payload.put("name", player.name);
                payload.put("phase", STATE.phase);
                payload.put("alive", player.alive);
                payload.put("role", "night0".equals(STATE.phase) ? player.role : null);
                List<Map<String, Object>> players = new ArrayList<>();
                for (Player p : STATE.players) {
                    players.add(Map.of("id", p.id, "name", p.name, "alive", p.alive));
                }
                payload.put("players", players);
                writeJson(exchange, 200, payload);
            }
            return;
        }

        if ("POST".equals(method) && "/api/gm/config".equals(path)) {
            JsonObject body = readBodyJson(exchange);
            synchronized (LOCK) {
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(exchange, 409, Map.of("error", "Cannot update config after game start."));
                    return;
                }
                RoleConfig next = new RoleConfig(
                        intValue(body, "mafia"),
                        intValue(body, "sheriff"),
                        intValue(body, "doctor"),
                        intValue(body, "vigilante"),
                        intValue(body, "town")
                );
                if (!next.valid()) {
                    writeJson(exchange, 400, Map.of("error", "All role values must be integers >= 0."));
                    return;
                }
                STATE.config = next;
                writeJson(exchange, 200, Map.of(
                        "ok", true,
                        "config", STATE.config.toMap(),
                        "expectedRoleTotal", rolePool(STATE.config).size()
                ));
            }
            return;
        }

        if ("POST".equals(method) && "/api/gm/start".equals(path)) {
            synchronized (LOCK) {
                if (!"lobby".equals(STATE.phase)) {
                    writeJson(exchange, 409, Map.of("error", "Game already started."));
                    return;
                }
                if (STATE.players.size() < 4) {
                    writeJson(exchange, 400, Map.of("error", "Need at least 4 players to start."));
                    return;
                }
                List<String> pool = rolePool(STATE.config);
                if (pool.size() != STATE.players.size()) {
                    writeJson(exchange, 400, Map.of("error",
                            "Role count (%d) must equal player count (%d).".formatted(pool.size(), STATE.players.size())));
                    return;
                }
                Collections.shuffle(pool);
                for (int i = 0; i < STATE.players.size(); i++) {
                    Player player = STATE.players.get(i);
                    player.role = pool.get(i);
                    player.alive = true;
                }
                STATE.phase = "night0";
                STATE.round = 0;
                writeJson(exchange, 200, Map.of("ok", true, "phase", STATE.phase));
            }
            return;
        }

        if ("POST".equals(method) && "/api/gm/reset".equals(path)) {
            synchronized (LOCK) {
                STATE.reset();
            }
            writeJson(exchange, 200, Map.of("ok", true));
            return;
        }

        writeJson(exchange, 404, Map.of("error", "API route not found."));
    }

    private static Map<String, Object> gmStatePayload() {
        List<Map<String, Object>> players = new ArrayList<>();
        int aliveCount = 0;
        for (Player p : STATE.players) {
            if (p.alive) aliveCount++;
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("id", p.id);
            info.put("name", p.name);
            info.put("alive", p.alive);
            info.put("role", p.role);
            players.add(info);
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("phase", STATE.phase);
        payload.put("round", STATE.round);
        payload.put("players", players);
        payload.put("playerCount", STATE.players.size());
        payload.put("aliveCount", aliveCount);
        payload.put("config", STATE.config.toMap());
        payload.put("expectedRoleTotal", rolePool(STATE.config).size());
        return payload;
    }

    private static Player findPlayer(String id) {
        for (Player p : STATE.players) {
            if (p.id.equals(id)) return p;
        }
        return null;
    }

    private static int intValue(JsonObject body, String key) {
        return body.has(key) ? body.get(key).getAsInt() : -1;
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

    private static JsonObject readBodyJson(HttpExchange exchange) throws IOException {
        try (InputStream in = exchange.getRequestBody()) {
            byte[] bytes = in.readAllBytes();
            if (bytes.length == 0) return new JsonObject();
            return GSON.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
        } catch (Exception ex) {
            return new JsonObject();
        }
    }

    private static void writeJson(HttpExchange exchange, int status, Object data) throws IOException {
        byte[] bytes = GSON.toJson(data).getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static void serveStatic(HttpExchange exchange, String path) throws IOException {
        String normalized = "/".equals(path) ? "/index.html" : path;
        if (normalized.contains("..")) {
            exchange.sendResponseHeaders(403, -1);
            return;
        }

        String resourcePath = "/public" + normalized;
        try (InputStream in = Main.class.getResourceAsStream(resourcePath)) {
            if (in == null) {
                exchange.sendResponseHeaders(404, -1);
                return;
            }
            byte[] bytes = in.readAllBytes();
            Headers headers = exchange.getResponseHeaders();
            headers.set("Content-Type", contentType(normalized));
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        }
    }

    private static String contentType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".json")) return "application/json; charset=utf-8";
        return "text/plain; charset=utf-8";
    }

    private static List<String> getLanUrls(int port) {
        List<String> urls = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nics = NetworkInterface.getNetworkInterfaces();
            while (nics.hasMoreElements()) {
                NetworkInterface nic = nics.nextElement();
                if (!nic.isUp() || nic.isLoopback()) continue;
                Enumeration<InetAddress> addresses = nic.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        urls.add("http://" + address.getHostAddress() + ":" + port);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return urls;
    }

    private static final class GameState {
        String phase = "lobby";
        int round = 0;
        List<Player> players = new ArrayList<>();
        RoleConfig config = new RoleConfig(2, 1, 1, 1, 1);

        void reset() {
            phase = "lobby";
            round = 0;
            players = new ArrayList<>();
            config = new RoleConfig(2, 1, 1, 1, 1);
        }
    }

    private static final class RoleConfig {
        int mafia;
        int sheriff;
        int doctor;
        int vigilante;
        int town;

        RoleConfig(int mafia, int sheriff, int doctor, int vigilante, int town) {
            this.mafia = mafia;
            this.sheriff = sheriff;
            this.doctor = doctor;
            this.vigilante = vigilante;
            this.town = town;
        }

        boolean valid() {
            return mafia >= 0 && sheriff >= 0 && doctor >= 0 && vigilante >= 0 && town >= 0;
        }

        Map<String, Integer> toMap() {
            Map<String, Integer> map = new HashMap<>();
            map.put("mafia", mafia);
            map.put("sheriff", sheriff);
            map.put("doctor", doctor);
            map.put("vigilante", vigilante);
            map.put("town", town);
            return map;
        }
    }

    private static final class Player {
        String id;
        String name;
        boolean alive;
        String role;

        Player(String id, String name) {
            this.id = id;
            this.name = name;
            this.alive = true;
            this.role = null;
        }
    }
}
