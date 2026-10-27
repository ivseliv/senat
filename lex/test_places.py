"""Карта и список используют одну выборку и считают разные решения."""
import subprocess
import unittest
from pathlib import Path


class PlacesTests(unittest.TestCase):
    def test_filters_counts_aliases_and_unresolved(self):
        subprocess.run(['node','eval/places-core.js'],cwd=Path(__file__).resolve().parent,check=True)


if __name__=='__main__':unittest.main()
