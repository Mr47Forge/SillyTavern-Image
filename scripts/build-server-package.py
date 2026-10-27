"""Build or verify the backend download used by the plugin's installation guide."""
import argparse, hashlib, pathlib, zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
source = pathlib.Path(__file__).resolve().parent.parent / 'server-plugin'
target = source / 'sillytavern-image-server.zip'
checksum = source / 'SHA256SUMS'
files = {}
for path in sorted(source.rglob('*')):
    if not path.is_file() or path.is_symlink() or path in (target, checksum):
        continue
    relative = path.relative_to(source)
    if any(part in {'node_modules', '.git', '__pycache__', 'data', 'backups'} for part in relative.parts):
        continue
    if path.suffix in {'.log', '.tmp', '.pyc', '.bak', '.backup'}:
        continue
    files['sillytavern-image-server/' + relative.as_posix()] = path
if not files or 'sillytavern-image-server/index.js' not in files:
    raise SystemExit('后台源码目录无效')
if not args.check:
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in files.items():
            info = zipfile.ZipInfo(name, (2026, 10, 27, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            # Git stores text with LF; the download must match on every OS.
            archive.writestr(info, path.read_bytes().replace(b'\r\n', b'\n'))
    checksum.write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '  ' + target.name + '\n', encoding='utf-8')
with zipfile.ZipFile(target) as archive:
    if archive.testzip() or len(archive.namelist()) != len(files) or set(archive.namelist()) != set(files):
        raise SystemExit('后台安装包目录校验失败')
    for name, path in files.items():
        if archive.read(name) != path.read_bytes().replace(b'\r\n', b'\n'):
            raise SystemExit('后台安装包与源码不一致：' + name)
if checksum.read_text(encoding='utf-8').split()[0] != hashlib.sha256(target.read_bytes()).hexdigest():
    raise SystemExit('后台安装包校验值不一致')
print('后台下载包与当前源码一致，共', len(files), '个文件')
