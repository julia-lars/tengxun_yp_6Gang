#!/bin/bash
# Run labeling with resume
# Usage: bash scripts/_run_labeling.sh [--retry-failed]
cd /Users/jessicajyan/tengxun_yp_6Gang
echo "Starting labeling at $(date)"
python3 scripts/label_all_v3.py --resume --workers 1 --batch 5 "$@"
echo "Labeling finished at $(date)"