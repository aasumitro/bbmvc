#!/bin/sh
# On the server, nightly: dump Nakama's database and archive the game server's
# match records to backups/ (the newest 14 of each), then delete the guests
# older than 3 days, whom tonight's dump still holds (nakama/data/modules/guests.lua).
# Cron:  0 3 * * * ~/scrapyard/scripts/backup.sh
# Restore (from repo root):
#   gunzip -c backups/nakama-<time>.sql.gz | podman compose -f "$(pwd)/deploy/compose.yml" exec -T postgres psql -U postgres nakama
#   gunzip -c backups/matches-<time>.tar.gz | podman compose -f "$(pwd)/deploy/compose.yml" exec -T game tar -xf - -C /home/node/matches
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
time=$(date +%Y%m%d-%H%M%S)
# -f needs an absolute path: podman-compose mis-resolves a relative one and fails with FileNotFoundError
compose() { podman compose -f "$(pwd)/deploy/compose.yml" "$@"; }

compose exec -T postgres pg_dump -U postgres nakama | gzip > "backups/nakama-$time.sql.gz"
# the records (matches-YYYY-MM.jsonl), not the replays: those only live 3 days
compose exec -T game tar -cf - -C /home/node/matches --exclude replays . | gzip > "backups/matches-$time.tar.gz"
for kind in nakama matches; do
  ls -1t backups/"$kind"-*.gz | tail -n +15 | xargs -r rm --
done
echo "backups/nakama-$time.sql.gz"
echo "backups/matches-$time.tar.gz"

# From inside Caddy's container, which holds the runtime HTTP key and reaches
# Nakama on the compose network: the key stays off this shell and the internet.
guests=$(compose exec -T caddy sh -c 'wget -qO- --post-data "" "http://nakama:7350/v2/rpc/prune_guests?http_key=$NAKAMA_HTTP_KEY&unwrap"')
echo "guests: $guests"
