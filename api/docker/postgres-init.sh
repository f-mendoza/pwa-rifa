#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="$RIFA_DB_USER" \
  --set=app_password="$RIFA_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'app_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'rifa_test', :'app_user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', 'rifa_integration', :'app_user') \gexec
SQL
