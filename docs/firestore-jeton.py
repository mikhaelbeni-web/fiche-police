# docs/firestore-jeton.py
# Jeton d'accès Firestore pour les tâches planifiées et les scripts (compte de
# service, rôle « Cloud Datastore User »). Lit la clé JSON du compte de service,
# encodée en base64, dans la variable d'environnement FIRESTORE_SA_B64
# (environnement cloud uniquement, JAMAIS dans le dépôt). Affiche le jeton
# (valable 1 h) sur la sortie standard. Usage :
#   FTOK=$(python3 docs/firestore-jeton.py)
#   curl -H "Authorization: Bearer $FTOK" https://firestore.googleapis.com/v1/projects/beylev-linge/databases/(default)/documents/...
# Ne jamais afficher, écrire ni transmettre FIRESTORE_SA_B64 ou le jeton.
import base64, json, os, sys, time, urllib.parse, urllib.request
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

raw = os.environ.get("FIRESTORE_SA_B64")
if not raw:
    sys.exit("FIRESTORE_SA_B64 absente")
sa = json.loads(base64.b64decode(raw))
b64 = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=")
now = int(time.time())
head = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
claims = b64(json.dumps({
    "iss": sa["client_email"],
    "scope": "https://www.googleapis.com/auth/datastore",
    "aud": "https://oauth2.googleapis.com/token",
    "iat": now, "exp": now + 3600,
}).encode())
key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
sig = key.sign(head + b"." + claims, padding.PKCS1v15(), hashes.SHA256())
jwt = (head + b"." + claims + b"." + b64(sig)).decode()
data = urllib.parse.urlencode({
    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
    "assertion": jwt,
}).encode()
with urllib.request.urlopen("https://oauth2.googleapis.com/token", data) as r:
    print(json.load(r)["access_token"])
