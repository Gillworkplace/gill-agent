import os
import unittest
from unittest.mock import patch
from gill_core.config import Settings

class TeamSettingsTests(unittest.TestCase):
    def test_explicit_openai_compatible_base_url_is_used(self):
        with patch.dict(os.environ,{"ZHIPU_BASE_URL":"https://example.invalid/v1"}):
            self.assertEqual(Settings().zhipu_base_url,"https://example.invalid/v1")
