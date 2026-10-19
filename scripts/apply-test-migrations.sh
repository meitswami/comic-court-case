#!/usr/bin/env bash
# Create a throwaway test database and apply every migration, for `npm test`.
# Usage: scripts/apply-test-migrations.sh [db_name]   (uses the local mysql client)
# Never point this at a production database.
set -euo pipefail
DB="${1:-enyayasetu_test}"
cd "$(dirname "$0")/.."
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
for f in mysql/migrations/0*.sql; do
  case "$f" in *phpmyadmin*) continue ;; esac
  echo "applying $f"
  mysql "$DB" < "$f"
done
echo "Test database $DB is ready. Grant a user access and set TEST_DB_* (see tests/setup/env.js)."
