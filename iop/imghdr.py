# imghdr polyfill for Python 3.13+
import struct

def what(file, h=None):
    if h is None:
        if isinstance(file, str):
            with open(file, 'rb') as f:
                h = f.read(32)
        else:
            location = file.tell()
            h = file.read(32)
            file.seek(location)

    if h[:8] == b'\211PNG\r\n\032\n':
        return 'png'
    if h[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if h[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if h[:4] == b'RIFF' and h[8:12] == b'WEBP':
        return 'webp'
    if h[:2] in (b'MM', b'II'):
        return 'tiff'
    if h[:2] == b'BM':
        return 'bmp'
    return None
