use aop_desktop_lib::installers::{
    InstallerRegistry, InstallerTooling, SetupActionError, SetupActionKind, setup_guide_url,
};
use aop_desktop_lib::platform::Platform;

fn unix(tooling: InstallerTooling) -> InstallerRegistry {
    InstallerRegistry::new(Platform::Unix, tooling)
}

fn windows(winget: bool) -> InstallerRegistry {
    InstallerRegistry::new(
        Platform::Windows,
        InstallerTooling {
            homebrew: false,
            winget,
        },
    )
}

#[test]
fn github_cli_install_opens_the_official_page() {
    let registry = unix(InstallerTooling {
        homebrew: true,
        winget: false,
    });

    let plan = registry.plan("install-github-cli").expect("plan exists");

    assert_eq!(plan.kind, SetupActionKind::Command);
    let command = plan.command.expect("command");
    assert_eq!(command.program, "open");
    assert_eq!(command.args, vec!["https://cli.github.com/"]);
}

#[test]
fn setup_guides_only_accept_known_install_actions() {
    for (action, url) in [
        ("install-git", "https://git-scm.com/install/mac"),
        ("install-github-cli", "https://cli.github.com/"),
        (
            "install-runtime-claude",
            "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code",
        ),
        (
            "install-runtime-codex",
            "https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started",
        ),
        ("install-runtime-opencode", "https://opencode.ai/docs/"),
        (
            "install-runtime-pi",
            "https://pi.dev/docs/latest/quickstart",
        ),
    ] {
        assert_eq!(setup_guide_url(action), Ok(url));
    }
    assert_eq!(
        setup_guide_url("install-everything"),
        Err(SetupActionError::UnknownAction)
    );
}

#[test]
fn github_cli_install_does_not_depend_on_homebrew() {
    let registry = unix(InstallerTooling {
        homebrew: false,
        winget: false,
    });

    let plan = registry.plan("install-github-cli").expect("plan exists");

    assert_eq!(plan.kind, SetupActionKind::Command);
    assert_eq!(plan.command.expect("command").program, "open");
}

#[test]
fn runtime_installers_open_official_guides() {
    let registry = unix(InstallerTooling {
        homebrew: true,
        winget: false,
    });

    let codex = registry.plan("install-runtime-codex").expect("codex plan");
    let claude = registry
        .plan("install-runtime-claude")
        .expect("claude plan");
    let opencode = registry
        .plan("install-runtime-opencode")
        .expect("opencode plan");

    assert_eq!(
        codex.command.expect("command").args,
        vec!["https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started"]
    );
    assert_eq!(
        claude.command.expect("command").args,
        vec!["https://code.claude.com/docs/en/quickstart#step-1-install-claude-code"]
    );
    assert_eq!(
        opencode.command.expect("command").args,
        vec!["https://opencode.ai/docs/"]
    );
}

#[test]
fn setup_install_actions_open_the_requested_documentation_pages() {
    let registry = unix(InstallerTooling {
        homebrew: true,
        winget: false,
    });

    for (action, url) in [
        ("install-git", "https://git-scm.com/install/mac"),
        ("install-github-cli", "https://cli.github.com/"),
        (
            "install-runtime-claude",
            "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code",
        ),
        (
            "install-runtime-codex",
            "https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started",
        ),
        ("install-runtime-opencode", "https://opencode.ai/docs/"),
        (
            "install-runtime-pi",
            "https://pi.dev/docs/latest/quickstart",
        ),
    ] {
        let plan = registry.plan(action).expect("guide action plan");
        let command = plan.command.expect("browser command");
        assert_eq!(command.program, "open");
        assert_eq!(command.args, vec![url]);
    }
}

#[test]
fn unknown_setup_action_is_rejected() {
    let registry = unix(InstallerTooling {
        homebrew: true,
        winget: false,
    });

    let error = registry
        .plan("install-everything")
        .expect_err("unknown action");

    assert_eq!(error, SetupActionError::UnknownAction);
}

#[test]
fn unix_installs_browser_runtime_and_codex_control_plugins() {
    let registry = unix(InstallerTooling {
        homebrew: true,
        winget: false,
    });

    let browser = registry.plan("install-browser-runtime").expect("plan");
    assert!(
        browser
            .command_preview
            .contains("playwright@1.61.1 install chromium")
    );

    let codex = registry
        .plan("install-codex-browser-plugins")
        .expect("plan");
    assert!(codex.command_preview.contains("browser@openai-bundled"));
    assert!(codex.command_preview.contains("chrome@openai-bundled"));

    let computer = registry
        .plan("install-codex-computer-plugin")
        .expect("plan");
    assert!(
        computer
            .command_preview
            .contains("computer-use@openai-bundled")
    );
}

#[test]
fn windows_uses_manual_wsl_browser_setup_and_opens_claude_extension() {
    let browser = windows(true).plan("install-browser-runtime").expect("plan");
    assert_eq!(browser.kind, SetupActionKind::Manual);
    assert!(browser.manual_instructions.contains("playwright@1.61.1"));

    let claude = windows(true)
        .plan("install-claude-browser-extension")
        .expect("plan");
    assert_eq!(claude.kind, SetupActionKind::Command);
    assert!(
        claude
            .command_preview
            .contains("fcoeoabgfenejglbffodgkkbkcdhcgfn")
    );
}

#[test]
fn windows_install_git_opens_the_requested_page() {
    let plan = windows(true).plan("install-git").expect("plan exists");

    assert_eq!(plan.kind, SetupActionKind::Command);
    let command = plan.command.expect("command");
    assert_eq!(command.program, "cmd");
    assert_eq!(
        command.args,
        ["/C", "start", "", "https://git-scm.com/install/mac"]
    );
}

#[test]
fn windows_install_github_cli_opens_the_official_page() {
    let plan = windows(true)
        .plan("install-github-cli")
        .expect("plan exists");

    let command = plan.command.expect("command");
    assert_eq!(command.program, "cmd");
    assert_eq!(
        command.args.last().map(String::as_str),
        Some("https://cli.github.com/")
    );
}

#[test]
fn windows_install_guides_do_not_depend_on_winget() {
    let git = windows(false).plan("install-git").expect("plan");
    assert_eq!(git.kind, SetupActionKind::Command);

    let gh = windows(false).plan("install-github-cli").expect("plan");
    assert_eq!(gh.kind, SetupActionKind::Command);
}

#[test]
fn windows_runtime_agents_open_guides() {
    let claude = windows(true).plan("install-runtime-claude").expect("plan");

    assert_eq!(claude.kind, SetupActionKind::Command);
    assert_eq!(claude.command.expect("command").program, "cmd");
}
