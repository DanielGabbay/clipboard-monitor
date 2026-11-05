#!/bin/bash
# One-time setup: create a self-signed code-signing identity "Clipboard Monitor Dev" in the login keychain.
#
# Why: an ad-hoc signature changes with every build, so macOS treats each build as a new app and the Keychain asks
# again for access to the stored AI keys. Signing every build with the same certificate keeps the app's identity
# stable. build.sh picks this identity up automatically.
#
# What it does: makes a 10-year RSA certificate with keyUsage=digitalSignature and extendedKeyUsage=codeSigning
# (openssl), then imports the certificate and its private key into the login keychain, allowing /usr/bin/codesign
# to use the key. macOS may ask for your login keychain password. Nothing else is changed.
# Remove it later with:  security delete-identity -c "Clipboard Monitor Dev"
set -euo pipefail

NAME="Clipboard Monitor Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
DAYS=3650

# Prefer the system LibreSSL; any openssl works because the .p12 below uses algorithms `security import` reads.
OPENSSL=/usr/bin/openssl
[ -x "$OPENSSL" ] || OPENSSL=$(command -v openssl) || { echo "openssl not found" >&2; exit 1; }

if security find-identity -p codesigning 2>/dev/null | grep -qF "\"$NAME\""; then
  echo "A \"$NAME\" identity already exists:"
  security find-identity -p codesigning | grep -F "\"$NAME\""
  echo "Nothing to do. To recreate it, first run:  security delete-identity -c \"$NAME\""
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Random password for the temporary .p12 only (the keychain item itself is protected by the keychain).
P12_PASS=$("$OPENSSL" rand -hex 16)

cat > "$TMP/cert.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions    = ext
prompt             = no
[ dn ]
CN = $NAME
[ ext ]
basicConstraints       = critical, CA:false
keyUsage               = critical, digitalSignature
extendedKeyUsage       = critical, codeSigning
subjectKeyIdentifier   = hash
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null

# SHA1/3DES PBE and a SHA1 MAC: the .p12 encryption macOS `security import` accepts (OpenSSL 3+ defaults to AES).
"$OPENSSL" pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -out "$TMP/identity.p12" -passout "pass:$P12_PASS"

security import "$TMP/identity.p12" -k "$KEYCHAIN" -f pkcs12 -P "$P12_PASS" -T /usr/bin/codesign

echo
echo "Imported \"$NAME\" into the login keychain:"
security find-identity -p codesigning | grep -F "\"$NAME\"" || true
cat <<EOF

Next: run ./build.sh. It signs with this identity when codesign accepts it.

If build.sh still says "codesign refused the identity" (or find-identity marks it CSSMERR_TP_NOT_TRUSTED and
codesign fails), trust the certificate for code signing once:
  1. Open Keychain Access, select the login keychain, Certificates, and double-click "$NAME".
  2. Expand "Trust" and set "Code Signing" to "Always Trust". Close the window and enter your password.
If codesign asks for keychain access while building, choose "Always Allow".
EOF
