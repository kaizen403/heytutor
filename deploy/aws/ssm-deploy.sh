#!/usr/bin/env bash
# Fixed entry point for the Commit-only AcceluteDeploy SSM document.
set -euo pipefail

if [ "$#" -ne 0 ] || [[ ! "${SSM_Commit:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "AcceluteDeploy requires one validated Commit environment parameter." >&2
  exit 1
fi

cd /opt/heytutor
# Git and its private credential helper run as the fixed checkout owner.
# Root performs the later service/dependency deployment, not Git authentication.
deployment_git() {
  sudo -H -u ubuntu env GIT_TERMINAL_PROMPT=0 git -C /opt/heytutor "$@"
}
# Credentials belong in the VM's credential helper, never in a remote URL.
case "$(deployment_git remote get-url origin 2>/dev/null)" in
  https://github.com/kaizen403/heytutor.git|https://github.com/kaizen403/heytutor|git@github.com:kaizen403/heytutor.git) ;;
  *) echo "The production origin is not the trusted HeyTutor repository." >&2; exit 1 ;;
esac

if ! deployment_git fetch --no-tags --prune origin \
  '+refs/heads/main:refs/remotes/origin/main' \
  '+refs/heads/dev:refs/remotes/origin/dev' >/dev/null 2>&1; then
  echo "Unable to fetch the trusted deployment branches." >&2
  exit 1
fi

if [ "$SSM_Commit" != "$(deployment_git rev-parse refs/remotes/origin/main)" ] && \
   [ "$SSM_Commit" != "$(deployment_git rev-parse refs/remotes/origin/dev)" ]; then
  echo "Commit is not a current trusted deployment branch head." >&2
  exit 1
fi

deployment_git reset --hard "$SSM_Commit" >/dev/null
./deploy/aws/deploy.sh

for attempt in $(seq 1 24); do
  if curl --connect-timeout 2 --max-time 5 -fsS \
    http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    echo "Tutor deploy and local health check succeeded."
    exit 0
  fi
  sleep 5
done
echo "Tutor health check failed after deployment; inspect protected service logs." >&2
exit 1
