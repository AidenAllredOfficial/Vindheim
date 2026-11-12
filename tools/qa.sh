#!/usr/bin/env bash
# QA driver: boots the game offline with a seeded profile and runs scripted steps.
#   tools/qa.sh <element> <out.png> "<extra eval steps>" [w] [h] [query]
EL=$1; OUT=$2; STEPS=$3; W=${4:-1280}; H=${5:-720}; Q=${6:-offline=1}; EXTRA=${7:-}
QA=$(tr '\n' ' ' < /tmp/qa/qa.js)
timeout 290 node tools/shot.mjs "http://localhost:5173/?$Q" "$OUT" --w=$W --h=$H --wait=3000 --logs=14 $EXTRA --eval="$QA;;;QA.seed('$EL'); location.reload();;;sleep:17000;;;$QA;;;$STEPS" 2>&1 | grep -v "vite\]"
