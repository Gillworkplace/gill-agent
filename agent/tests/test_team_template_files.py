"""Verify authorized template paths, instruction order and sandbox staging."""
import io
import tarfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

from gill_core.team_template_files import TemplatePackage
from gill_core.team_turns import TeamTurn


class TemplatePackageTests(unittest.IsolatedAsyncioTestCase):
    async def test_task_uses_frozen_directories_independently_of_template_paths(self) -> None:
        turn = TeamTurn(Mock(), Mock(), {"id": "turn"})

        def manifest(key: str) -> list[dict]:
            return [{"path": "rules.md", "key": key, "size": 4, "utf8": True, "purpose": "prompt"}]

        turn.context = {
            "kind": "turn",
            "team": {"promptFiles": manifest("team")},
            "employee": {"promptFiles": manifest("employee"), "files": manifest("template")},
        }
        turn._consume_model = AsyncMock(return_value=("", []))
        with patch("gill_core.team_template_files.read_template_file", AsyncMock(side_effect=[
            b"TEAM", b"WORK", b"BASE",
        ])):
            await turn.model_request()
            system = turn._consume_model.await_args.args[1]
            self.assertIn("[团队流程目录指令]\n[prompt rules.md]\nTEAM", system)
            self.assertIn("[实际员工工作目录指令]\n[prompt rules.md]\nWORK", system)
            self.assertIn("[模板文件指令]\n[prompt rules.md]\nBASE", system)
            packages = turn.prompt_packages()
            self.assertEqual((await packages["team"].read_for_model("rules.md"))["content"], "TEAM")
            self.assertEqual((await packages["employee"].read_for_model("rules.md"))["content"], "WORK")
            self.assertEqual((await packages["template"].read_for_model("rules.md"))["content"], "BASE")

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
        sandbox.write_transfer = AsyncMock()
        with patch("gill_core.team_template_files.read_template_file", AsyncMock(return_value=data)):
            await package.stage(sandbox)
        target, archive = sandbox.write_transfer.call_args.args
        self.assertTrue(target.startswith("/tmp/"))
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            self.assertEqual(tar.getnames(), ["assets/fixture.bin"])
            self.assertEqual(tar.extractfile("assets/fixture.bin").read(), data)
        self.assertIn("-C /tmp/gill-template", sandbox.run.call_args.args[0])
