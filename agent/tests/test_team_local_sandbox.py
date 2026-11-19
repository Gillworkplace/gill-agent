import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gill_core.team_local_sandbox import LocalDockerSandbox, LocalWorker


class LocalSandboxTests(unittest.IsolatedAsyncioTestCase):
    """Protect local job isolation and workspace recovery."""

    def test_directory_inspection_and_selection_stay_inside_the_startup_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / "root"
            nested = root / "projects"
            nested.mkdir(parents=True)
            (nested / ".git").mkdir()
            (root / ".gill").mkdir()
            (root / "escape").symlink_to(root.parent, target_is_directory=True)
            local = LocalWorker(root, 1, "", "runner")
            self.assertEqual(local.inspect_directory(""), {"children": ["projects"], "hasGit": False})
            self.assertTrue(local.inspect_directory("projects")["hasGit"])
            selection = {"id": "project", "localDirectory": {"rootId": local.binding, "path": "projects"}}
            self.assertEqual(local.directory_for(selection), nested)
            for invalid in ("../", "/projects", "escape", ".gill"):
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    local.resolve_directory(invalid)
            other = LocalWorker(root, 1, "", "other")
            with self.assertRaises(ValueError):
                other.directory_for(selection)

    async def test_paths_survive_restart_and_jobs_do_not_share_workspaces(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            first = LocalDockerSandbox(source, "one", "", "runner")
            second = LocalDockerSandbox(source, "two", "", "runner")
            first_id = await first.connect()
            await second.connect()
            self.assertNotEqual(first.workspace, second.workspace)
            self.assertTrue(first.workspace.is_dir())
            restored = LocalDockerSandbox(source, "one", first_id, "runner")
            self.assertEqual(await restored.connect(), first_id)
            wrong = LocalDockerSandbox(source, "two", first_id, "runner")
            with self.assertRaises(ValueError):
                await wrong.connect()

    async def test_ordinary_commands_mount_only_execution_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            sandbox = LocalDockerSandbox(Path(temporary), "one", "", "runner")
            await sandbox.connect()
            with patch("gill_core.team_local_sandbox.subprocess.run") as docker:
                docker.return_value.returncode = 0
                docker.return_value.stdout = b"verified"
                docker.return_value.stderr = b""
                result = await sandbox.run("pwd")
            args = docker.call_args.args[0]
            self.assertEqual(result["stdout"], "verified")
            self.assertNotIn("/gill-source", " ".join(args))
            self.assertNotIn("docker.sock", " ".join(args))
            self.assertIn(f"type=bind,src={sandbox.workspace},dst=/workspace", args)
