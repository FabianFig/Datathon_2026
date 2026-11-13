import csv
import tempfile
import unittest
from pathlib import Path

from src.catalog import image_path, load_catalog, pairs, search_pairs
from src.vision import parse_response


class CatalogTests(unittest.TestCase):
    def test_catalog_pairs_and_search(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with (root / "image_metadata.csv").open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["image_id", "image_path", "paired_image_id", "acquisition_date", "locality"])
                writer.writeheader()
                writer.writerow({"image_id": "late", "image_path": "images/late.png", "paired_image_id": "early", "acquisition_date": "2017-09-01", "locality": "Houston"})
                writer.writerow({"image_id": "early", "image_path": "images/early.png", "paired_image_id": "late", "acquisition_date": "2016-01-01", "locality": "Houston"})
                writer.writerow({"image_id": "solo", "image_path": "images/solo.png", "paired_image_id": "", "acquisition_date": "2025-07-11", "locality": "Kerrville"})
            rows = load_catalog(root)
            found = pairs(rows)
            self.assertEqual([(a["image_id"], b["image_id"]) for a, b in found], [("early", "late")])
            self.assertEqual(len(search_pairs(found, "houston")), 1)
            self.assertEqual(len(search_pairs(found, "kerrville")), 0)
            self.assertEqual(image_path(root, rows[0]), (root / "images/late.png").resolve())

    def test_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                image_path(Path(folder), {"image_path": "../private.png"})

    def test_response_validation(self):
        payload = '{"summary":"Change unclear","visible_water_before":"uncertain","visible_water_after":"uncertain","evidence":["Image 1 shows a road"],"limitations":["Clouds obscure Image 2"],"review_priority":"low"}'
        self.assertEqual(parse_response(payload)["review_priority"], "low")
        with self.assertRaises(ValueError):
            parse_response(payload.replace('"low"', '"urgent"'))


if __name__ == "__main__":
    unittest.main()
