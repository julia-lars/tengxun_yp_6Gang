#!/bin/bash
cd /Users/jessicajyan/tengxun_yp_6Gang
exec python3 scripts/label_all_v3.py --resume --workers 1 --limit-files 3 2>&1