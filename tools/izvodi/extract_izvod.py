"""Usage: python3 -I extract_izvod.py OUTDIR SAVED_TOOL_RESULT.txt [...]
Saves each PDF attachment as OUTDIR/<gmail-id>__<original-name>.pdf and prints one line per file: OK <id> <subject> -> <path>"""
import json,base64,email,sys,os,re
from email.header import decode_header,make_header
out=sys.argv[1];os.makedirs(out,exist_ok=True)
for f in sys.argv[2:]:
    try:
        j=json.load(open(f));r=j['raw'];mid=j.get('id','x')
        raw=base64.urlsafe_b64decode(r.replace('+','-').replace('/','_')+'='*(-len(r)%4))
        m=email.message_from_bytes(raw);subj=str(make_header(decode_header(m.get('Subject',''))))
        n=0
        for part in m.walk():
            fn=part.get_filename()
            if fn: fn=str(make_header(decode_header(fn)))
            if part.get_content_type()=='application/pdf' or (fn and fn.lower().endswith('.pdf')):
                name=re.sub(r'[^\w.-]+','_',os.path.basename(fn or 'att.pdf')).strip('_')
                p=os.path.join(out,f'{mid}__{name}');open(p,'wb').write(part.get_payload(decode=True));n+=1
                print('OK',mid,subj,'->',p)
        if not n: print('NOPDF',mid,subj)
    except Exception as e: print('ERR',f,e)
