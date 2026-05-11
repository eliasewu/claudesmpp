#!/bin/bash
cd /home/debian/sms-gateway

git config --global --add safe.directory /home/debian/sms-gateway
git add .
git commit -m "Update: SMPP bind checker, auto invoicing, full live logs with DLR details" 2>/dev/null || echo "No changes"
git push origin main 2>/dev/null && echo "✅ Pushed to GitHub!" || echo "Push failed - check token"
