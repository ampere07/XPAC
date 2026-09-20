#!/usr/bin/env bash
#
# Exports the upload certificate (PEM) from a keystore you downloaded from EAS,
# for use with Google Play Console -> App signing -> Request upload key reset.
#
# WHAT YOU DO FIRST (manual, interactive, needs your EAS login):
#   1) cd frontend
#   2) eas credentials --platform android
#        -> production -> Keystore -> Download credentials
#      This gives you a keystore file (e.g. keystore.jks) and prints
#      keystorePassword / keyAlias / keyPassword. Note those down.
#
# THEN run this script:
#   ./export-upload-cert.sh <keystore-file> <keyAlias> <keystorePassword>
#
# It auto-finds keytool (Android Studio's bundled JDK) or falls back to openssl,
# writes upload_certificate.pem, and prints the SHA-1 fingerprint.
#
set -euo pipefail

KEYSTORE="${1:-}"
ALIAS="${2:-}"
STOREPASS="${3:-}"
CERT="upload_certificate.pem"

usage() {
  echo "Usage: $0 <keystore-file> <keyAlias> <keystorePassword>" >&2
  echo "  e.g. $0 keystore.jks upload 'the-password-from-eas'" >&2
  exit 1
}

[ -n "$KEYSTORE" ] && [ -n "$ALIAS" ] && [ -n "$STOREPASS" ] || usage
[ -f "$KEYSTORE" ] || { echo "ERROR: keystore not found: $KEYSTORE" >&2; exit 1; }

# --- locate a keytool binary -------------------------------------------------
find_keytool() {
  if command -v keytool >/dev/null 2>&1; then command -v keytool; return; fi
  local candidates=(
    "${JAVA_HOME:-}/bin/keytool"
    /opt/android-studio/jbr/bin/keytool
    "$HOME/android-studio/jbr/bin/keytool"
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"
    /usr/lib/jvm/*/bin/keytool
    "$HOME/Android/Sdk"/*/bin/keytool
  )
  local c
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  return 1
}

KEYTOOL="$(find_keytool || true)"

if [ -n "$KEYTOOL" ]; then
  echo "==> Using keytool: $KEYTOOL"
  "$KEYTOOL" -export -rfc \
    -keystore "$KEYSTORE" \
    -alias "$ALIAS" \
    -file "$CERT" \
    -storepass "$STOREPASS"

  echo
  echo "==> SHA-1 fingerprint of exported key:"
  "$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$STOREPASS" \
    | grep -i 'SHA1:' || true
else
  echo "==> keytool not found; trying openssl (works only if keystore is PKCS12)..."
  if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: neither keytool nor openssl available." >&2
    echo "Install a JDK, or use Android Studio's keytool at <AndroidStudio>/jbr/bin/keytool" >&2
    exit 1
  fi
  # PKCS12 path (modern keystores). Fails cleanly if it's a legacy JKS.
  openssl pkcs12 -in "$KEYSTORE" -nokeys -clcerts -passin pass:"$STOREPASS" -out "$CERT" 2>/dev/null || {
    echo "ERROR: openssl could not read '$KEYSTORE' (likely legacy JKS format)." >&2
    echo "Use Android Studio's keytool instead:" >&2
    echo "  <AndroidStudio>/jbr/bin/keytool -export -rfc -keystore $KEYSTORE -alias $ALIAS -file $CERT -storepass '$STOREPASS'" >&2
    exit 1
  }
  echo
  echo "==> SHA-1 fingerprint of exported key:"
  openssl x509 -in "$CERT" -noout -fingerprint -sha1 2>/dev/null || true
fi

echo
echo "==> Done. Wrote: $CERT"
echo "    Upload this in Play Console -> App signing -> Request upload key reset."
