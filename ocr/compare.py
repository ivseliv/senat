import sys,re,unicodedata,difflib
def norm(s):
    s=s.lower()
    s=re.sub(r'-\n','',s)
    for a,b in (('ѣ','е'),('і','и'),('ѳ','ф'),('ѵ','и'),('ъ',''),('ь',''),('ё','е'),('й','и')): s=s.replace(a,b)
    s=re.sub(r'[^а-яa-z0-9%№]','',s)
    return s
def lev(a,b):
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        cur=[i]
        for j,cb in enumerate(b,1):
            cur.append(min(prev[j]+1,cur[j-1]+1,prev[j-1]+(ca!=cb)))
        prev=cur
    return prev[-1]
def cmp(mine,other,label):
    a=norm(open(mine,encoding='utf-8').read()); b=norm(open(other,encoding='utf-8').read())
    d=lev(a,b)
    print(f'{label}: mine={len(a)} other={len(b)} edit={d} diff={d/len(a):.2%}')
    sm=difflib.SequenceMatcher(None,a,b,autojunk=False)
    out=[]
    for tag,i1,i2,j1,j2 in sm.get_opcodes():
        if tag!='equal': out.append((a[max(0,i1-8):i2+8],b[max(0,j1-8):j2+8]))
    return out
if __name__=='__main__':
    for lab,(m,o) in {'L':('s060_L.txt','abbyy_L.txt'),'R':('s060_R.txt','abbyy_R.txt')}.items():
        ds=cmp(m,o,lab)
        for x,y in ds[:40]: print('  mine:',x,'| abbyy:',y)
