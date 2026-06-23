#!/usr/bin/env python3
"""Read chunks tool-results dump and reconstruct HTML."""
import re, base64, sys, json

# We don't have direct file; expecting input as path passed
path = sys.argv[1]
text = open(path).read()
# Each line like: N: [map[chunk:....   or continuation lines.
# Easier: extract content between `chunk:` and `]]` per row.
rows = re.findall(r'chunk:([A-Za-z0-9+/=\n\s]+?)\]\]', text)
print('rows found', len(rows), file=sys.stderr)
b64 = ''.join(r.replace('\n','').replace(' ','').replace('\r','') for r in rows)
# Drop any non-b64 chars
b64 = re.sub(r'[^A-Za-z0-9+/=]','', b64)
html = base64.b64decode(b64).decode('utf-8')
open('.lovable/artifacts/site018-hero-before.html','w').write(html)
print('html len', len(html), file=sys.stderr)
