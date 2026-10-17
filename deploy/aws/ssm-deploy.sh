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

# Run the requested commit's deploy driver without updating the live checkout.
# The fixed launcher itself is installed once by the owner; see ci-cd.md.
driver="$(mktemp /tmp/heytutor-deploy.XXXXXXXX)"
trap 'rm -f "$driver"' EXIT
deployment_git show "$SSM_Commit:deploy/aws/deploy.sh" > "$driver"
/usr/bin/bash "$driver" "$SSM_Commit"
