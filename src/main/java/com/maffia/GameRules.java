package com.maffia;

import java.util.HashMap;
import java.util.Map;

final class GameRules {
    private GameRules() {}

    static String majorityTarget(Map<String, String> voteMap, int voterCount) {
        int needed = (voterCount / 2) + 1;
        return winningTarget(tallyVotes(voteMap), needed);
    }

    static String pluralityTarget(Map<String, String> voteMap) {
        return winningTarget(tallyVotes(voteMap), 1);
    }

    static Map<String, Integer> tallyVotes(Map<String, String> votes) {
        Map<String, Integer> t = new HashMap<>();
        for (String v : votes.values()) {
            if (v == null) continue;
            t.put(v, t.getOrDefault(v, 0) + 1);
        }
        return t;
    }

    private static String winningTarget(Map<String, Integer> counts, int minimum) {
        String best = null;
        int bestCount = 0;
        boolean tie = false;
        for (Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() > bestCount) {
                best = e.getKey();
                bestCount = e.getValue();
                tie = false;
            } else if (e.getValue() == bestCount) {
                tie = true;
            }
        }
        return bestCount >= minimum && !tie ? best : null;
    }
}
