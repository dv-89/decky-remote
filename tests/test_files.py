from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'py_modules'))
from file_browser import FileBrowser


class FileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.home.mkdir()
        self.media = self.root / 'media'
        self.sd = self.media / 'SD card'
        self.sd.mkdir(parents=True)
        self.files = FileBrowser(self.home, self.media)

    def tearDown(self):
        self.temp.cleanup()

    def test_browsing_roots_hidden_files_and_parent_boundary(self):
        (self.home / 'z folder').mkdir()
        (self.home / 'a.txt').write_bytes(b'abc')
        (self.home / '.hidden').write_bytes(b'x')
        result = self.files.list()
        self.assertEqual([entry['name'] for entry in result['entries']], ['z folder', 'a.txt'])
        self.assertEqual(result['parent'], '')
        self.assertEqual(len(result['roots']), 2)
        self.assertIn('.hidden', [entry['name'] for entry in self.files.list(hidden=True)['entries']])
        self.assertEqual(self.files.list(str(self.home / 'z folder'))['parent'], str(self.home))
        self.assertEqual(self.files.list(str(self.sd))['parent'], '')
        self.assertEqual(self.files.list('~/z folder')['path'], str(self.home / 'z folder'))
        self.assertEqual(self.files.list('~')['path'], str(self.home))

    def test_paths_cannot_escape_home_or_media(self):
        for value in (str(self.root), str(self.home / '..'), 'x\0', 123, 'x' * 4097):
            with self.assertRaises((ValueError, OSError)):
                self.files.list(value)
        with self.assertRaises(ValueError):
            self.files.list(hidden='yes')

    def test_copy_to_media_preserves_contents_without_overwriting(self):
        source = self.home / 'test.bin'
        content = bytes(range(256)) * 10000
        source.write_bytes(content)
        result = self.files.copy(str(source), str(self.sd))
        self.assertEqual((self.sd / source.name).read_bytes(), content)
        self.assertEqual(source.read_bytes(), content)
        self.assertEqual(result['bytes'], len(content))
        with self.assertRaises(FileExistsError):
            self.files.copy(str(source), str(self.sd))
        self.assertEqual((self.sd / source.name).read_bytes(), content)
        with self.assertRaises(FileExistsError):
            self.files.copy(str(source), str(self.home))

    def test_copy_rejects_folders_and_out_of_scope_paths(self):
        source = self.home / 'test.txt'
        source.write_text('hello', encoding='utf-8')
        for src, dst in ((str(self.home), str(self.sd)), (str(source), str(self.root)), (str(source), str(source))):
            with self.assertRaises(ValueError):
                self.files.copy(src, dst)

    def test_failed_copy_removes_partial_destination(self):
        source = self.home / 'test.txt'
        source.write_bytes(b'hello')
        with patch('file_browser.os.fsync', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.files.copy(str(source), str(self.sd))
        self.assertFalse((self.sd / source.name).exists())
        self.assertEqual(source.read_bytes(), b'hello')

    def test_directory_listing_is_bounded(self):
        for i in range(501):
            (self.home / str(i)).touch()
        result = self.files.list()
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['entries']), 500)

    def test_links_cannot_escape_roots_or_replace_a_destination(self):
        outside = self.root / 'outside.txt'
        outside.write_bytes(b'untouched')
        source = self.home / 'file.txt'
        source.write_bytes(b'copy')
        try:
            (self.home / 'escape').symlink_to(self.root, target_is_directory=True)
            (self.home / 'storage').symlink_to(self.sd, target_is_directory=True)
            (self.sd / source.name).symlink_to(outside)
        except OSError as error:
            self.skipTest(f'Symlink creation unavailable on this host: {error}')
        with self.assertRaises(ValueError):
            self.files.list(str(self.home / 'escape'))
        listing = {entry['name']: entry for entry in self.files.list()['entries']}
        self.assertEqual(listing['escape']['kind'], 'link')
        self.assertEqual(listing['storage']['kind'], 'folder')
        self.assertEqual(self.files.list(str(self.home / 'storage'))['path'], str(self.sd))
        with self.assertRaises(FileExistsError):
            self.files.copy(str(source), str(self.sd))
        with self.assertRaises(ValueError):
            self.files.copy(str(self.sd / source.name), str(self.home))
        self.assertEqual(outside.read_bytes(), b'untouched')


if __name__ == '__main__':
    unittest.main()
