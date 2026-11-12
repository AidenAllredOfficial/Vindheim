#!/usr/bin/env bash
# Scripted play sessions for visual QA: boots the game in offline practice with a seeded profile,
# injects the QA driver (tools/qa-driver.js) and runs eval steps (see tools/shot.mjs).
#
#   tools/qa.sh "<seed args>" <out.png|jpg> "<steps>" [width] [height] [query] [extra shot.mjs flags]
#   BASE=http://localhost:8787 tools/qa.sh "'storm'" /tmp/fight.jpg \
#     "__vindheim.play({type:'public'});;;sleep:11000;;;__vindheim.net.send({t:'cmd',c:'deploy'});;;sleep:4000;;;QA.fight(9);;;sleep:6000"
#
# <seed args> are passed to QA.seed(equipped, ownedCount, glory), e.g. "'frost',3,860".
DIR="$(cd "$(dirname "$0")" && pwd)"
EL=$1; OUT=$2; STEPS=$3; W=${4:-1280}; H=${5:-720}; Q=${6:-offline=1}; EXTRA=${7:-}
QA=$(tr '\n' ' ' < "$DIR/qa-driver.js")
timeout 290 node "$DIR/shot.mjs" "${BASE:-http://localhost:5173}/?$Q" "$OUT" --w=$W --h=$H --wait=3000 --logs=14 $EXTRA \
  --eval="$QA;;;QA.seed($EL); location.reload();;;sleep:17000;;;$QA;;;$STEPS" 2>&1 | grep -v "vite\]"
