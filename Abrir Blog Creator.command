#!/bin/zsh
cd "$(dirname "$0")"
node server.js &
BLOG_CREATOR_PID=$!
sleep 1
open "http://127.0.0.1:4545"
wait "$BLOG_CREATOR_PID"
