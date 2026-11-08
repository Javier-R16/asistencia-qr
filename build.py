import pathlib
d=pathlib.Path(__file__).parent
gas=(d/'Code.gs').read_text()
assert '</script' not in gas
t=(d/'src/index.template.html').read_text()
(d/'index.html').write_text(t.replace('/*__GAS_SOURCE__*/',gas))
print('index.html', len((d/'index.html').read_text())//1024,'KB')
