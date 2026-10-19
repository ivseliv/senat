"""Справки не переносят устаревшие цитаты, чужие выводы или личные заметки в ссылку."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class ResearchTests(unittest.TestCase):
    def test_research_sources_sharing_and_export(self):
        subprocess.run(['node', 'eval/research-core.js'], cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
