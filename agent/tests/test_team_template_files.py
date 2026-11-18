"""Verify authorized template paths, instruction order and sandbox staging."""
import io
import tarfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

from gill_core.team_template_files import TemplatePackage


class TemplatePackageTests(unittest.IsolatedAsyncioTestCase):
    async def test_selected_instructions_keep_their_paths_and_reference_files_are_lazy(self) -> None:
        package = TemplatePackage([
            {"path": "AGENTS.md", "key": "main", "size": 1, "utf8": True, "purpose": "prompt"},
            {"path": "prompts/review.md", "key": "rules", "size": 1, "utf8": True, "purpose": "prompt"},
            {"path": "skills/review/SKILL.md", "key": "skill", "size": 1, "utf8": True, "purpose": "skill"},
            {"path": "references/evidence.txt", "key": "data", "size": 1, "utf8": True, "purpose": "resource"},
        ])
        read = AsyncMock(side_effect=[b"A", b"B", b"C", b"D"])
        with patch("gill_core.team_template_files.read_template_file", read):
            self.assertEqual(await package.instructions(),
                             "[prompt AGENTS.md]\nA\n\n[prompt prompts/review.md]\nB\n\n[skill skills/review/SKILL.md]\nC")
            self.assertEqual(read.await_count, 3)
            self.assertEqual((await package.read_for_model("references/evidence.txt"))["content"], "D")
            with self.assertRaises(ValueError):
                await package.read("../evidence.txt")
            self.assertEqual(read.await_count, 4)

    async def test_staging_keeps_binary_bytes_and_stays_outside_the_project_tree(self) -> None:
        package = TemplatePackage([
            {"path": "assets/fixture.bin", "key": "binary", "size": 4, "utf8": False, "purpose": "resource"}
        ])
        data = bytes([0, 255, 0, 42])
        sandbox = Mock()
        sandbox.run = AsyncMock(return_value={"exitCode": 0})
        with patch("gill_core.team_template_files.read_template_file", AsyncMock(return_value=data)):
            await package.stage(sandbox)
        target, archive = sandbox.box.files.write.call_args.args
        self.assertTrue(target.startswith("/tmp/"))
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            self.assertEqual(tar.getnames(), ["assets/fixture.bin"])
            self.assertEqual(tar.extractfile("assets/fixture.bin").read(), data)
        self.assertIn("-C /tmp/gill-template", sandbox.run.call_args.args[0])
