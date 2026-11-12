import json,copy,sys
src=json.load(open('database.rules.json'))
r=copy.deepcopy(src['rules'])
changed=[]
def member(root,var):
    return ("(root.child('%s').child(%s).child('players').child(auth.uid).exists() || "
            "root.child('%s').child(%s).child('meta').child('hostUid').val() == auth.uid)")%(root,var,root,var)
def patch(node,path,prefix,mem):
    for k,v in node.items():
        if k=='.read' and isinstance(v,str) and v.startswith(prefix) and v.strip()==prefix:
            node[k]=prefix+' && '+mem; changed.append(path)
        elif isinstance(v,dict): patch(v,path+'/'+k,prefix,mem)
RC="auth != null && $code.matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/)"
MP="auth != null && $pin.matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)"
rc=[v for k,v in r['rooms'].items() if k.startswith('$')][0]
mc=[v for k,v in r['mlt'].items() if k.startswith('$')][0]
mem_r=member('rooms','$code'); mem_m=member('mlt','$pin')
for k,v in rc.items():
    if k in('meta','players') or not isinstance(v,dict): continue
    patch(v,'rooms/$code/'+k,RC,mem_r)
for k,v in mc.items():
    if k in('meta','cast') or not isinstance(v,dict): continue
    patch(v,'mlt/$pin/'+k,MP,mem_m)
# reveal-gated nodes: add the membership clause to the existing read rule
for k in ('answers','sealed','call'):
    def add(node,path):
        for kk,v in node.items():
            if kk=='.read' and isinstance(v,str) and v.startswith(RC) and 'revealed' in v:
                node[kk]=v+' && '+mem_r; changed.append(path)
            elif isinstance(v,dict): add(v,path+'/'+kk)
    add(rc[k],'rooms/$code/'+k)
# players: open to anyone only while in lobby; members/host always; own row always
rc['players']['.read']=RC+" && (root.child('rooms').child($code).child('meta').child('status').val() == 'lobby' || "+mem_r+")"
rc['players']['$uid']['.read']="auth != null && auth.uid == $uid"
mc['players']['.read']=MP+" && (root.child('mlt').child($pin).child('meta').child('status').val() == 'lobby' || "+mem_m+")"
mc['players']['$uid']['.read']="auth != null && auth.uid == $uid"
changed+=['rooms/$code/players','rooms/$code/players/$uid','mlt/$pin/players','mlt/$pin/players/$uid']
out={"rules":r}
json.dump(out,open(sys.argv[1],'w'),indent=2)
print(len(changed));print('\n'.join(changed))
