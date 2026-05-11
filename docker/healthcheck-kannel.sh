#!/bin/bash
if curl -s -f "http://localhost:13000/status?password=secret123" > /dev/null 2>&1; then
  echo "Kannel Bearerbox is healthy"
  exit 0
else
  echo "Kannel is not ready yet"
  exit 1
fi
