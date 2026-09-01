#!/bin/bash
# Phase 2 wrapper script
cd /Users/jessicajyan/tengxun_yp_6Gang
exec python3 -u scripts/eval_run_v3.py data/eval/test_cases_persona_v2.0.json --all-personas --resume --judge-rounds 3