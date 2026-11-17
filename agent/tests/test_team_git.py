import unittest
from gill_core.team_git import validate_integration

class GitPolicyTests(unittest.TestCase):
    def test_protected_branch_cannot_be_integrated_autonomously(self):
        project={"targetBranch":"main","protectedBranches":["main"],"checkCommand":"true","baselineCommit":"a"}
        with self.assertRaises(ValueError): validate_integration(project,"a")

    def test_moved_target_cannot_reuse_old_check(self):
        project={"targetBranch":"main","checkCommand":"test -f proof.txt","baselineCommit":"new"}
        with self.assertRaises(ValueError): validate_integration(project,"old")

    def test_requires_real_configured_check_and_accepts_current_authorized_target(self):
        project={"targetBranch":"integration","checkCommand":"","baselineCommit":"a"}
        with self.assertRaises(ValueError): validate_integration(project,"a")
        project["checkCommand"]="test -f proof.txt"
        self.assertEqual(validate_integration(project,"a"),"integration")
