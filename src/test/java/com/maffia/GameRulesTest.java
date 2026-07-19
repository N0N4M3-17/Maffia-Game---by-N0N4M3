package com.maffia;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNull;

class GameRulesTest {
    @Test
    void strictMajorityRequiresMoreThanHalfOfAliveVoters() {
        Map<String, String> votes = Map.of(
                "p1", "target-a",
                "p2", "target-a",
                "p3", "target-b"
        );

        assertEquals("target-a", GameRules.majorityTarget(votes, 3));
        assertNull(GameRules.majorityTarget(votes, 4));
    }

    @Test
    void strictMajorityIgnoresAbstentionsAndSkipsNoMajority() {
        Map<String, String> votes = new java.util.LinkedHashMap<>();
        votes.put("p1", "target-a");
        votes.put("p2", null);
        votes.put("p3", null);

        assertNull(GameRules.majorityTarget(votes, 3));
    }

    @Test
    void tiesDoNotResolveEvenWhenVoteCountMeetsThreshold() {
        Map<String, String> votes = Map.of(
                "p1", "target-a",
                "p2", "target-a",
                "p3", "target-b",
                "p4", "target-b"
        );

        assertNull(GameRules.majorityTarget(votes, 4));
        assertNull(GameRules.pluralityTarget(votes));
    }

    @Test
    void pluralityStillNeedsUniqueLeaderForLegacyNightResolution() {
        Map<String, String> votes = Map.of(
                "p1", "target-a",
                "p2", "target-b",
                "p3", "target-a"
        );

        assertEquals("target-a", GameRules.pluralityTarget(votes));
    }

    @Test
    void townWinsOnlyAfterAssignedRolesWhenNoMafiaRemain() {
        assertEquals("Town", GameRules.winnerFor(0, 3, true, false));
        assertNull(GameRules.winnerFor(0, 3, false, false));
    }

    @Test
    void mafiaWinsAtParityOrMajority() {
        assertEquals("Mafia", GameRules.winnerFor(1, 1, true, false));
        assertEquals("Mafia", GameRules.winnerFor(2, 1, true, false));
    }

    @Test
    void armedVigilanteDuelWinsBeforeMafiaParity() {
        assertEquals("Vigilante", GameRules.winnerFor(1, 1, true, true));
    }

    @Test
    void gameContinuesWhileTownOutnumbersMafia() {
        assertNull(GameRules.winnerFor(1, 2, true, false));
    }

    @Test
    void nightPhaseOrderSkipsDeadOrMissingOptionalRoles() {
        assertEquals("night_sheriff", GameRules.nextNightRolePhase("night_mafia", true, true, true));
        assertEquals("night_doctor", GameRules.nextNightRolePhase("night_mafia", false, true, true));
        assertEquals("night_vigilante", GameRules.nextNightRolePhase("night_mafia", false, false, true));
        assertNull(GameRules.nextNightRolePhase("night_mafia", false, false, false));
    }

    @Test
    void nightPhaseOrderContinuesFromCurrentRoleOnly() {
        assertEquals("night_doctor", GameRules.nextNightRolePhase("night_sheriff", true, true, true));
        assertEquals("night_vigilante", GameRules.nextNightRolePhase("night_sheriff", false, false, true));
        assertEquals("night_vigilante", GameRules.nextNightRolePhase("night_doctor", true, true, true));
        assertNull(GameRules.nextNightRolePhase("night_vigilante", true, true, true));
    }

    @Test
    void nightPhaseOrderRejectsNonNightRolePhase() {
        assertThrows(IllegalArgumentException.class, () -> GameRules.nextNightRolePhase("discussion", true, true, true));
    }
}
