/** Frozen M06 recorded beat; fixture only, never a topic template in product. */
import type { SceneDocument } from "@heytutor/scene-engine";
import type { AudioTimings } from "@heytutor/tutor-core";
import type { DrawCommand } from "@heytutor/drawing";
export const probabilityIntroFixture: {
  document: SceneDocument; narration: string; timings: AudioTimings;
  commands: DrawCommand[]; expectedPrimitiveIds: string[];
} = JSON.parse(String.raw`{
  "document": {
    "source": {
      "question": "A bag has 3 red balls and 2 blue balls. Two balls are drawn without replacement. Use a probability tree to find the probability both are red."
    },
    "entities": [
      {
        "id": "givenR",
        "kind": "point",
        "role": "helper point",
        "label": "R=3"
      },
      {
        "id": "givenB",
        "kind": "point",
        "role": "helper point",
        "label": "B=2"
      },
      {
        "id": "givenN",
        "kind": "point",
        "role": "helper point",
        "label": "n=2"
      },
      {
        "id": "t0",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tR",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tB",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tRR",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tRB",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tBR",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "tBB",
        "kind": "point",
        "role": "helper point"
      },
      {
        "id": "eR",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "eB",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "eRR",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "eRB",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "eBR",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "eBB",
        "kind": "polyline",
        "role": "polyline"
      },
      {
        "id": "leafRR",
        "kind": "label",
        "role": "label"
      },
      {
        "id": "leafRB",
        "kind": "label",
        "role": "label"
      },
      {
        "id": "leafBR",
        "kind": "label",
        "role": "label"
      },
      {
        "id": "leafBB",
        "kind": "label",
        "role": "label"
      }
    ],
    "relations": [],
    "assertions": [
      {
        "id": "assert_label_givenR",
        "reason": "student-facing points must stay labeled",
        "entities": [
          "givenR"
        ],
        "expected": true,
        "severity": "fatal",
        "predicate": "label_attached"
      },
      {
        "id": "assert_label_givenB",
        "reason": "student-facing points must stay labeled",
        "entities": [
          "givenB"
        ],
        "expected": true,
        "severity": "fatal",
        "predicate": "label_attached"
      },
      {
        "id": "assert_label_givenN",
        "reason": "student-facing points must stay labeled",
        "entities": [
          "givenN"
        ],
        "expected": true,
        "severity": "fatal",
        "predicate": "label_attached"
      }
    ],
    "quantities": [
      {
        "id": "g1",
        "unit": "balls",
        "value": 3,
        "symbol": "R",
        "provenance": "given"
      },
      {
        "id": "g2",
        "unit": "balls",
        "value": 2,
        "symbol": "B",
        "provenance": "given"
      },
      {
        "id": "g3",
        "unit": "draws",
        "value": 2,
        "symbol": "n",
        "provenance": "given"
      },
      {
        "id": "u1",
        "value": 0.3,
        "symbol": "P(RR)",
        "dependsOn": [
          "g1",
          "g2",
          "g3"
        ],
        "provenance": "derived"
      }
    ],
    "annotations": [
      {
        "id": "redRoute",
        "kind": "trace",
        "targetIds": [
          "eR",
          "eRR"
        ]
      }
    ],
    "revealGroups": [
      {
        "id": "setup",
        "dependsOn": [],
        "entityIds": [
          "givenR",
          "givenB",
          "givenN"
        ],
        "narrationCue": "reveal scene"
      },
      {
        "id": "tree",
        "dependsOn": [],
        "entityIds": [
          "t0",
          "tR",
          "tB",
          "tRR",
          "tRB",
          "tBR",
          "tBB",
          "eR",
          "eB",
          "eRR",
          "eRB",
          "eBR",
          "eBB",
          "leafRR",
          "leafRB",
          "leafBR",
          "leafBB"
        ],
        "narrationCue": "reveal scene"
      }
    ],
    "constructions": [
      {
        "id": "cGivenR",
        "inputs": {
          "x": 0,
          "y": 0,
          "coordinateSpace": "layout"
        },
        "outputs": [
          "givenR"
        ],
        "operator": "point"
      },
      {
        "id": "cGivenB",
        "inputs": {
          "x": 1,
          "y": 0,
          "coordinateSpace": "layout"
        },
        "outputs": [
          "givenB"
        ],
        "operator": "point"
      },
      {
        "id": "cGivenN",
        "inputs": {
          "x": 2,
          "y": 0,
          "coordinateSpace": "layout"
        },
        "outputs": [
          "givenN"
        ],
        "operator": "point"
      },
      {
        "id": "cTree",
        "inputs": {
          "nodes": [
            {
              "id": "start",
              "outcome": "Start"
            },
            {
              "id": "red1",
              "parent": "start",
              "outcome": "R",
              "probability": 0.6
            },
            {
              "id": "blue1",
              "parent": "start",
              "outcome": "B",
              "probability": 0.4
            },
            {
              "id": "red2afterR",
              "parent": "red1",
              "outcome": "R",
              "probability": 0.5
            },
            {
              "id": "blue2afterR",
              "parent": "red1",
              "outcome": "B",
              "probability": 0.5
            },
            {
              "id": "red2afterB",
              "parent": "blue1",
              "outcome": "R",
              "probability": 0.75
            },
            {
              "id": "blue2afterB",
              "parent": "blue1",
              "outcome": "B",
              "probability": 0.25
            }
          ]
        },
        "outputs": [
          "t0",
          "tR",
          "tB",
          "tRR",
          "tRB",
          "tBR",
          "tBB",
          "eR",
          "eB",
          "eRR",
          "eRB",
          "eBR",
          "eBB",
          "leafRR",
          "leafRB",
          "leafBR",
          "leafBB"
        ],
        "operator": "probability_tree"
      }
    ],
    "schemaVersion": "scene-document/v2",
    "visualDecision": {
      "mode": "scene",
      "reason": "planner visual decision"
    },
    "teachingTimeline": [],
    "requiredEntityIds": [
      "givenR",
      "givenB",
      "givenN",
      "t0",
      "tR",
      "tRR",
      "eR",
      "eRR",
      "leafRR",
      "tB",
      "tRB",
      "tBR",
      "tBB",
      "eB",
      "eRB",
      "eBR",
      "eBB",
      "leafRB",
      "leafBR",
      "leafBB"
    ]
  },
  "narration": "Next, first the polyline, and finally the helper point. All in place.",
  "timings": {
    "charDurations": [
      0.112028846,
      0.112028846,
      0.112028846,
      0.112028846,
      0.1120288460000001,
      0.0806538,
      0.07986923999999995,
      0.07986923999999995,
      0.07986924000000006,
      0.07986923999999984,
      0.07986924000000006,
      0.08000000000000007,
      0.02666666666666662,
      0.02666666666666684,
      0.02666666666666662,
      0.01000000000000001,
      0.06222222222222218,
      0.06222222222222218,
      0.06222222222222218,
      0.0622222222222224,
      0.06222222222222218,
      0.06222222222222218,
      0.06222222222222218,
      0.06222222222222218,
      0.06222222222222218,
      0.2146037999999999,
      0.06179873333333319,
      0.06179873333333363,
      0.06179873333333319,
      0.01,
      0.0685714285714285,
      0.0685714285714285,
      0.0685714285714285,
      0.06857142857142895,
      0.0685714285714285,
      0.0685714285714285,
      0.0685714285714285,
      0.08000000000000007,
      0.01,
      0.01,
      0.01,
      0.01,
      0.05333329999999981,
      0.05333330000000025,
      0.05333330000000025,
      0.05333329999999981,
      0.05333329999999981,
      0.05333330000000025,
      0.08000000000000007,
      0.05333333333333323,
      0.05333333333333323,
      0.05333333333333368,
      0.05333333333333323,
      0.05333333333333323,
      0.05333333333333323,
      0.3462057000000001,
      0.07126476666666681,
      0.07126476666666681,
      0.07126476666666637,
      0.08000000000000007,
      0.04000000000000004,
      0.04000000000000004,
      0.01,
      0.08000000000000007,
      0.08000000000000007,
      0.07999999999999918,
      0.08000000000000007,
      0.08000000000000007,
      0.08000000000000007
    ],
    "totalDuration": 4.64014423,
    "charStartTimes": [
      0,
      0.112028846,
      0.224057692,
      0.336086538,
      0.4481153839999999,
      0.56014423,
      0.64079803,
      0.72066727,
      0.8005365099999999,
      0.88040575,
      0.9602749899999998,
      1.04014423,
      1.12014423,
      1.146810896666667,
      1.173477563333333,
      1.20014423,
      1.20014423,
      1.262366452222222,
      1.324588674444444,
      1.386810896666667,
      1.449033118888889,
      1.511255341111111,
      1.573477563333333,
      1.635699785555556,
      1.697922007777778,
      1.76014423,
      1.97474803,
      2.036546763333333,
      2.098345496666667,
      2.16014423,
      2.16014423,
      2.228715658571428,
      2.297287087142857,
      2.365858515714285,
      2.434429944285714,
      2.503001372857143,
      2.571572801428571,
      2.64014423,
      2.72014423,
      2.72014423,
      2.72014423,
      2.72014423,
      2.72014443,
      2.77347773,
      2.82681103,
      2.88014433,
      2.93347763,
      2.98681093,
      3.04014423,
      3.12014423,
      3.173477563333333,
      3.226810896666667,
      3.28014423,
      3.333477563333334,
      3.386810896666667,
      3.44014423,
      3.78634993,
      3.857614696666667,
      3.928879463333334,
      4.00014423,
      4.08014423,
      4.12014423,
      4.16014423,
      4.16014423,
      4.24014423,
      4.32014423,
      4.40014423,
      4.48014423,
      4.56014423
    ]
  },
  "commands": [
    {
      "type": "DRAW_LINE",
      "params": [
        474,
        332.5,
        678,
        434.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eR"
      },
      "semanticRef": {
        "entityId": "eR",
        "primitiveId": "primitive_eR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.6",
      "type": "LABEL",
      "params": [
        555.1769376375025,
        456.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eR",
        "primitiveId": "primitive_eR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        474,
        332.5,
        678,
        230.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eB"
      },
      "semanticRef": {
        "entityId": "eB",
        "primitiveId": "primitive_eB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.4",
      "type": "LABEL",
      "params": [
        554.5769726258122,
        184.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eB",
        "primitiveId": "primitive_eB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        678,
        434.5,
        882,
        485.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eRR"
      },
      "semanticRef": {
        "entityId": "eRR",
        "primitiveId": "primitive_eRR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.5",
      "type": "LABEL",
      "params": [
        759.0589526258123,
        507.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eRR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eRR",
        "primitiveId": "primitive_eRR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        678,
        434.5,
        882,
        383.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eRB"
      },
      "semanticRef": {
        "entityId": "eRB",
        "primitiveId": "primitive_eRB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.5",
      "type": "LABEL",
      "params": [
        904,
        397,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eRB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eRB",
        "primitiveId": "primitive_eRB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        678,
        230.5,
        882,
        281.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eBR"
      },
      "semanticRef": {
        "entityId": "eBR",
        "primitiveId": "primitive_eBR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.75",
      "type": "LABEL",
      "params": [
        755.2822068170974,
        303.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eBR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eBR",
        "primitiveId": "primitive_eBR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        678,
        230.5,
        882,
        179.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eBB"
      },
      "semanticRef": {
        "entityId": "eBB",
        "primitiveId": "primitive_eBB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "p=0.25",
      "type": "LABEL",
      "params": [
        753.8759474379166,
        133.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "polyline",
        "entityId": "eBB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "eBB",
        "primitiveId": "primitive_eBB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        678,
        434.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tR"
      },
      "semanticRef": {
        "entityId": "tR",
        "primitiveId": "primitive_tR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "R",
      "type": "LABEL",
      "params": [
        669.71286,
        452.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tR",
        "primitiveId": "primitive_tR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        678,
        230.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tB"
      },
      "semanticRef": {
        "entityId": "tB",
        "primitiveId": "primitive_tB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "B",
      "type": "LABEL",
      "params": [
        670.49448,
        188.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tB",
        "primitiveId": "primitive_tB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        882,
        485.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tRR"
      },
      "semanticRef": {
        "entityId": "tRR",
        "primitiveId": "primitive_tRR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "R",
      "type": "LABEL",
      "params": [
        873.71286,
        443.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tRR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tRR",
        "primitiveId": "primitive_tRR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        882,
        383.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tRB"
      },
      "semanticRef": {
        "entityId": "tRB",
        "primitiveId": "primitive_tRB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "B",
      "type": "LABEL",
      "params": [
        874.49448,
        341.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tRB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tRB",
        "primitiveId": "primitive_tRB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        882,
        281.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tBR"
      },
      "semanticRef": {
        "entityId": "tBR",
        "primitiveId": "primitive_tBR"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "R",
      "type": "LABEL",
      "params": [
        873.71286,
        239.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tBR"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tBR",
        "primitiveId": "primitive_tBR_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_POINT",
      "params": [
        882,
        179.5,
        2
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tBB"
      },
      "semanticRef": {
        "entityId": "tBB",
        "primitiveId": "primitive_tBB"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "B",
      "type": "LABEL",
      "params": [
        874.49448,
        137.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "tBB"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "tBB",
        "primitiveId": "primitive_tBB_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "text": "Start",
      "type": "LABEL",
      "params": [
        449.7764869773885,
        280.5,
        24
      ],
      "syncable": true,
      "spokenCue": {
        "token": "helper point",
        "entityId": "t0"
      },
      "syncReason": "verified-scene-label",
      "semanticRef": {
        "entityId": "t0",
        "primitiveId": "primitive_t0_label"
      },
      "charPosition": 0,
      "narrationBefore": ""
    },
    {
      "type": "DRAW_LINE",
      "params": [
        474,
        332.5,
        474,
        313.5
      ],
      "syncable": false,
      "spokenCue": {
        "token": "helper point",
        "entityId": "t0"
      },
      "semanticRef": {
        "entityId": "t0",
        "primitiveId": "primitive_t0_label_leader"
      },
      "visualStyle": {
        "dashed": true,
        "strokeRole": "construction",
        "labelLeader": true
      },
      "charPosition": 0,
      "narrationBefore": ""
    }
  ],
  "expectedPrimitiveIds": [
    "primitive_eR",
    "primitive_eR_label",
    "primitive_eB",
    "primitive_eB_label",
    "primitive_eRR",
    "primitive_eRR_label",
    "primitive_eRB",
    "primitive_eRB_label",
    "primitive_eBR",
    "primitive_eBR_label",
    "primitive_eBB",
    "primitive_eBB_label",
    "primitive_tR",
    "primitive_tR_label",
    "primitive_tB",
    "primitive_tB_label",
    "primitive_tRR",
    "primitive_tRR_label",
    "primitive_tRB",
    "primitive_tRB_label",
    "primitive_tBR",
    "primitive_tBR_label",
    "primitive_tBB",
    "primitive_tBB_label",
    "primitive_t0_label",
    "primitive_t0_label_leader"
  ]
}`);
