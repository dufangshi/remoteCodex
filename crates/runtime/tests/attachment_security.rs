use remote_codex_runtime::files::read_thread_image;

#[test]
fn thread_images_are_scoped_and_cannot_serve_active_content() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".temp/threads/own")).unwrap();
    std::fs::create_dir_all(root.join(".temp/threads/other")).unwrap();
    let png = b"\x89PNG\r\n\x1a\nsynthetic";
    for path in [
        "private.png",
        ".temp/threads/own/ok.png",
        ".temp/threads/other/no.png",
    ] {
        std::fs::write(root.join(path), png).unwrap();
    }
    std::fs::write(
        root.join(".temp/threads/own/fake.png"),
        "<html><script>alert(1)</script>",
    )
    .unwrap();
    std::fs::write(
        root.join(".temp/threads/own/a.svg"),
        "<svg onload='alert(1)'/>",
    )
    .unwrap();
    assert_eq!(
        read_thread_image(root, "own", "./.temp/threads/own/ok.png")
            .unwrap()
            .1,
        "image/png"
    );
    for path in [
        "private.png",
        ".temp/threads/other/no.png",
        ".temp/threads/own/../../../private.png",
        ".temp/threads/own/fake.png",
        ".temp/threads/own/a.svg",
    ] {
        assert!(read_thread_image(root, "own", path).is_err(), "{path}");
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(
            root.join("private.png"),
            root.join(".temp/threads/own/link.png"),
        )
        .unwrap();
        assert!(read_thread_image(root, "own", ".temp/threads/own/link.png").is_err());
    }
}
