using System.Diagnostics;
using System.Runtime.InteropServices;
using RemoteCodex.DeviceManager.Infrastructure;
using RemoteCodex.DeviceManager.Models;
using RemoteCodex.DeviceManager.Services;

namespace RemoteCodex.DeviceManager.UI;

internal sealed class MainForm : Form
{
    private static readonly Color TextColor = Color.FromArgb(31, 35, 33);
    private static readonly Color MutedColor = Color.FromArgb(91, 99, 95);
    private static readonly Color AccentColor = Color.FromArgb(180, 83, 9);
    private static readonly Color OnlineColor = Color.FromArgb(22, 128, 74);
    private static readonly Color ErrorColor = Color.FromArgb(185, 28, 28);
    private static readonly Color WindowColor = Color.FromArgb(252, 252, 249);
    private static readonly Color SurfaceColor = Color.FromArgb(246, 247, 244);
    private static readonly Color BorderColor = Color.FromArgb(204, 208, 203);

    private readonly DeviceManagerController _controller;
    private readonly TextBox _pasteConfigurationTextBox;
    private readonly Label _pasteStateLabel;
    private readonly TextBox _relayUrlTextBox;
    private readonly TextBox _tokenTextBox;
    private readonly Label _tokenStateLabel;
    private readonly TextBox _workspaceTextBox;
    private readonly NumericUpDown _portInput;
    private readonly CheckBox _startWithWindowsCheckBox;
    private readonly Button _connectButton;
    private readonly Button _disconnectButton;
    private readonly Panel _statusDot;
    private readonly Label _statusTitle;
    private readonly Label _statusDetail;
    private readonly Label _stepLabel;
    private readonly ProgressBar _progressBar;
    private readonly Label _runtimeValue;
    private readonly Label _runtimeUpdateLabel;
    private readonly Button _checkUpdateButton;
    private readonly Button _updateButton;
    private bool _allowClose;
    private bool _isApplyingPaste;

    public MainForm(DeviceManagerController controller)
    {
        _controller = controller;
        Text = ProductManifest.ProductName;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(760, 800);
        ClientSize = new Size(820, 900);
        BackColor = WindowColor;
        ForeColor = TextColor;
        Font = new Font("Segoe UI", 10F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = WindowColor,
            Padding = new Padding(30, 24, 30, 22),
            ColumnCount = 1,
            RowCount = 5,
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));

        var header = new Panel { Dock = DockStyle.Fill };
        header.Controls.Add(new Label
        {
            AutoSize = true,
            Font = new Font("Segoe UI", 18F, FontStyle.Bold),
            Location = new Point(0, 0),
            Text = "Remote Codex device",
        });
        header.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = MutedColor,
            Location = new Point(2, 39),
            Text = "Windows Relay connection",
        });

        var statusPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = SurfaceColor,
            Padding = new Padding(18, 14, 18, 14),
        };
        var statusLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = SurfaceColor,
            ColumnCount = 2,
            RowCount = 2,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
        };
        statusLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 24));
        statusLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        _statusDot = new Panel
        {
            BackColor = Color.FromArgb(148, 163, 184),
            Anchor = AnchorStyles.None,
            Size = new Size(10, 10),
        };
        _statusTitle = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            Font = new Font(Font, FontStyle.Bold),
            Margin = Padding.Empty,
            TextAlign = ContentAlignment.MiddleLeft,
            Text = "Checking status",
        };
        _statusDetail = new Label
        {
            AutoEllipsis = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Margin = Padding.Empty,
            TextAlign = ContentAlignment.MiddleLeft,
            Text = "Waiting for the local supervisor.",
        };
        statusLayout.Controls.Add(_statusDot, 0, 0);
        statusLayout.SetRowSpan(_statusDot, 2);
        statusLayout.Controls.Add(_statusTitle, 1, 0);
        statusLayout.Controls.Add(_statusDetail, 1, 1);
        statusPanel.Controls.Add(statusLayout);

        var formGrid = new TableLayoutPanel
        {
            AutoScroll = true,
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 18, 0, 8),
            ColumnCount = 3,
            RowCount = 12,
        };
        formGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 146));
        formGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        formGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 126));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var pasteLabel = new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Font = new Font(Font, FontStyle.Bold),
            Text = "Paste device setup command",
        };
        formGrid.Controls.Add(pasteLabel, 0, 0);
        formGrid.SetColumnSpan(pasteLabel, 3);

        _pasteConfigurationTextBox = new TextBox
        {
            AcceptsReturn = true,
            AccessibleName = "Device setup command",
            Dock = DockStyle.Fill,
            Multiline = true,
            PlaceholderText = "Paste the PowerShell or shell command from the Relay portal",
            ScrollBars = ScrollBars.Vertical,
            WordWrap = false,
        };
        _pasteConfigurationTextBox.TextChanged += (_, _) => TryApplyPastedConfiguration(showErrors: false);
        formGrid.Controls.Add(_pasteConfigurationTextBox, 0, 1);
        formGrid.SetColumnSpan(_pasteConfigurationTextBox, 2);

        var pasteButton = CreateNeutralButton("Paste && fill", 118);
        pasteButton.AccessibleName = "Paste configuration and fill connection details";
        pasteButton.Dock = DockStyle.Fill;
        pasteButton.Margin = new Padding(10, 0, 0, 4);
        pasteButton.Click += PasteConfigurationClicked;
        formGrid.Controls.Add(pasteButton, 2, 1);

        _pasteStateLabel = new Label
        {
            AutoEllipsis = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Padding = new Padding(2, 4, 0, 0),
            Text = "PowerShell and shell formats supported. Parsed locally, never executed.",
        };
        formGrid.Controls.Add(_pasteStateLabel, 0, 2);
        formGrid.SetColumnSpan(_pasteStateLabel, 3);

        _relayUrlTextBox = CreateTextBox();
        _tokenTextBox = CreateTextBox();
        _tokenTextBox.UseSystemPasswordChar = true;
        _tokenTextBox.AccessibleName = "Relay device token";
        _tokenStateLabel = new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Padding = new Padding(3, 2, 0, 0),
        };
        _workspaceTextBox = CreateTextBox();
        _portInput = new NumericUpDown
        {
            Dock = DockStyle.Fill,
            Minimum = 1024,
            Maximum = 65535,
            ThousandsSeparator = false,
            AccessibleName = "Local supervisor port",
        };
        _startWithWindowsCheckBox = new CheckBox
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Text = "Start with Windows sign-in",
        };

        var showToken = new CheckBox
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Text = "Show",
        };
        showToken.CheckedChanged += (_, _) => _tokenTextBox.UseSystemPasswordChar = !showToken.Checked;

        var browseButton = new Button
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(8, 0, 0, 6),
            Text = "Browse...",
        };
        browseButton.Click += BrowseWorkspace;

        AddField(formGrid, "Workspace root", _workspaceTextBox, row: 3, spanRemainingColumns: false);
        formGrid.Controls.Add(browseButton, 2, 3);
        formGrid.Controls.Add(_startWithWindowsCheckBox, 1, 4);
        formGrid.SetColumnSpan(_startWithWindowsCheckBox, 2);

        var manualSettingsLabel = new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Margin = Padding.Empty,
            Padding = new Padding(0, 3, 0, 0),
            Text = "Manual settings (optional)",
        };
        formGrid.Controls.Add(manualSettingsLabel, 0, 5);
        formGrid.SetColumnSpan(manualSettingsLabel, 3);
        AddField(formGrid, "Relay URL", _relayUrlTextBox, row: 6);
        AddField(formGrid, "Device token", _tokenTextBox, row: 7, spanRemainingColumns: false);
        formGrid.Controls.Add(showToken, 2, 7);
        formGrid.Controls.Add(_tokenStateLabel, 1, 8);
        formGrid.SetColumnSpan(_tokenStateLabel, 2);
        AddField(formGrid, "Local port", _portInput, row: 9);

        var runtimePanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = SurfaceColor,
            Padding = new Padding(14, 10, 14, 8),
            Margin = new Padding(0, 4, 0, 4),
        };
        var runtimeLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            BackColor = SurfaceColor,
            ColumnCount = 4,
            RowCount = 2,
            Margin = Padding.Empty,
        };
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        runtimeLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        runtimeLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        runtimeLayout.Controls.Add(new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Font = new Font(Font, FontStyle.Bold),
            Margin = Padding.Empty,
            Text = "Runtime",
        }, 0, 0);
        _runtimeValue = new Label
        {
            AutoEllipsis = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Margin = Padding.Empty,
            Text = "Node.js, Codex, codex-acp and Remote Codex will be checked on connect.",
        };
        runtimeLayout.Controls.Add(_runtimeValue, 1, 0);
        _checkUpdateButton = CreateNeutralButton("Check", 88);
        _checkUpdateButton.AccessibleName = "Check for Remote Codex updates";
        _checkUpdateButton.Dock = DockStyle.Fill;
        _checkUpdateButton.Margin = new Padding(8, 0, 0, 2);
        _checkUpdateButton.Click += CheckUpdateClicked;
        runtimeLayout.Controls.Add(_checkUpdateButton, 2, 0);
        _updateButton = CreateNeutralButton("Update", 74);
        _updateButton.Dock = DockStyle.Fill;
        _updateButton.Margin = new Padding(8, 0, 0, 2);
        _updateButton.Enabled = false;
        _updateButton.Click += UpdateRuntimeClicked;
        runtimeLayout.Controls.Add(_updateButton, 3, 0);
        _runtimeUpdateLabel = new Label
        {
            AutoEllipsis = true,
            Dock = DockStyle.Fill,
            ForeColor = MutedColor,
            Margin = Padding.Empty,
            Text = "Check npm for a newer Remote Codex release.",
        };
        runtimeLayout.Controls.Add(_runtimeUpdateLabel, 1, 1);
        runtimeLayout.SetColumnSpan(_runtimeUpdateLabel, 3);
        runtimePanel.Controls.Add(runtimeLayout);
        formGrid.Controls.Add(runtimePanel, 0, 10);
        formGrid.SetColumnSpan(runtimePanel, 3);

        var progressPanel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 8, 0, 6) };
        _stepLabel = new Label
        {
            AutoEllipsis = true,
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = MutedColor,
            TextAlign = ContentAlignment.MiddleLeft,
            Text = "Ready",
        };
        _progressBar = new ProgressBar
        {
            Dock = DockStyle.Top,
            Height = 7,
            Maximum = 100,
            Style = ProgressBarStyle.Continuous,
        };
        progressPanel.Controls.Add(_progressBar);
        progressPanel.Controls.Add(_stepLabel);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Padding = new Padding(0, 8, 0, 0),
        };
        _connectButton = new Button
        {
            AutoSize = false,
            BackColor = AccentColor,
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.FromArgb(255, 252, 247),
            Margin = new Padding(8, 0, 0, 0),
            Size = new Size(100, 36),
            Text = "Start",
        };
        _connectButton.FlatAppearance.BorderSize = 0;
        _connectButton.Click += ConnectClicked;
        _disconnectButton = new Button
        {
            AutoSize = false,
            BackColor = WindowColor,
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(8, 0, 0, 0),
            Size = new Size(120, 36),
            Text = "Disconnect",
        };
        _disconnectButton.FlatAppearance.BorderColor = BorderColor;
        _disconnectButton.Click += DisconnectClicked;
        var openLogsButton = CreateNeutralButton("Open logs", 120);
        openLogsButton.Margin = new Padding(8, 0, 0, 0);
        openLogsButton.Click += (_, _) => OpenLogs();
        actions.Controls.AddRange([_connectButton, _disconnectButton, openLogsButton]);

        root.Controls.Add(header, 0, 0);
        root.Controls.Add(statusPanel, 0, 1);
        root.Controls.Add(formGrid, 0, 2);
        root.Controls.Add(progressPanel, 0, 3);
        root.Controls.Add(actions, 0, 4);
        Controls.Add(root);
        AcceptButton = _connectButton;

        _controller.Changed += ControllerChanged;
        LoadSettings();
        UpdateState();
        Resize += (_, _) =>
        {
            if (WindowState == FormWindowState.Minimized)
            {
                Hide();
            }
        };
    }

    public Task<bool> ConfirmCodexLoginAsync()
    {
        var result = MessageBox.Show(
            this,
            "Codex needs to sign in for this Windows user. Continue in a temporary terminal window?",
            "Codex sign-in",
            MessageBoxButtons.OKCancel,
            MessageBoxIcon.Information);
        return Task.FromResult(result == DialogResult.OK);
    }

    public async Task ApplyTokenAsync(string token)
    {
        _tokenTextBox.Text = token;
        await ConnectCurrentConfigurationAsync();
    }

    public void FocusToken()
    {
        _tokenTextBox.Clear();
        _tokenTextBox.Focus();
    }

    public void AllowCloseAndExit()
    {
        _allowClose = true;
        Close();
    }

    public static void OpenLogs()
    {
        AppPaths.EnsureDirectories();
        var target = File.Exists(AppPaths.RelayLogPath) ? AppPaths.RelayLogPath : AppPaths.LogPath;
        if (!File.Exists(target))
        {
            File.WriteAllText(target, string.Empty);
        }
        Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
    }

    protected override void OnFormClosing(FormClosingEventArgs eventArgs)
    {
        if (!_allowClose && eventArgs.CloseReason == CloseReason.UserClosing)
        {
            eventArgs.Cancel = true;
            Hide();
            return;
        }
        base.OnFormClosing(eventArgs);
    }

    private void LoadSettings()
    {
        _relayUrlTextBox.Text = _controller.Settings.RelayUrl;
        _workspaceTextBox.Text = _controller.Settings.WorkspaceRoot;
        _portInput.Value = Math.Clamp(_controller.Settings.SupervisorPort, (int)_portInput.Minimum, (int)_portInput.Maximum);
        _startWithWindowsCheckBox.Checked = _controller.Settings.StartWithWindows;
    }

    private async void ConnectClicked(object? sender, EventArgs eventArgs)
    {
        await ConnectCurrentConfigurationAsync();
    }

    private void PasteConfigurationClicked(object? sender, EventArgs eventArgs)
    {
        try
        {
            if (!Clipboard.ContainsText())
            {
                _pasteStateLabel.ForeColor = ErrorColor;
                _pasteStateLabel.Text = "The clipboard does not contain text.";
                return;
            }
            _pasteConfigurationTextBox.Text = Clipboard.GetText(TextDataFormat.Text);
            TryApplyPastedConfiguration(showErrors: true);
        }
        catch (Exception exception) when (exception is ExternalException or ThreadStateException)
        {
            _pasteStateLabel.ForeColor = ErrorColor;
            _pasteStateLabel.Text = "Clipboard access is unavailable. Paste into the box with Ctrl+V.";
        }
    }

    private void TryApplyPastedConfiguration(bool showErrors)
    {
        if (_isApplyingPaste || string.IsNullOrWhiteSpace(_pasteConfigurationTextBox.Text))
        {
            return;
        }
        if (!RelayConfigurationParser.TryParse(
                _pasteConfigurationTextBox.Text,
                out var configuration,
                out var error))
        {
            if (showErrors)
            {
                _pasteStateLabel.ForeColor = ErrorColor;
                _pasteStateLabel.Text = error;
            }
            return;
        }

        _relayUrlTextBox.Text = configuration!.RelayUrl;
        _tokenTextBox.Text = configuration.DeviceToken;
        if (configuration.SupervisorPort is { } port)
        {
            _portInput.Value = Math.Clamp(port, (int)_portInput.Minimum, (int)_portInput.Maximum);
        }

        _isApplyingPaste = true;
        _pasteConfigurationTextBox.Clear();
        _isApplyingPaste = false;
        _pasteStateLabel.ForeColor = OnlineColor;
        _pasteStateLabel.Text = configuration.SupervisorPort is null
            ? "Configuration parsed: Relay URL and device token filled."
            : "Configuration parsed: Relay URL, device token and local port filled.";
    }

    private async void CheckUpdateClicked(object? sender, EventArgs eventArgs)
    {
        try
        {
            await _controller.CheckRemoteCodexUpdateAsync();
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, AppLogger.Redact(exception.Message), "Update check failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async void UpdateRuntimeClicked(object? sender, EventArgs eventArgs)
    {
        try
        {
            await _controller.UpdateRemoteCodexAsync();
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, AppLogger.Redact(exception.Message), "Update failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task ConnectCurrentConfigurationAsync()
    {
        try
        {
            var configuration = new DeviceConfiguration(
                _relayUrlTextBox.Text,
                _tokenTextBox.Text,
                _workspaceTextBox.Text,
                decimal.ToInt32(_portInput.Value));
            await _controller.ConnectAsync(configuration, _startWithWindowsCheckBox.Checked, ConfirmCodexLoginAsync);
            _tokenTextBox.Clear();
        }
        catch (OperationCanceledException)
        {
            // The UI already reflects the cancelled setup state.
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, AppLogger.Redact(exception.Message), "Connection failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async void DisconnectClicked(object? sender, EventArgs eventArgs)
    {
        try
        {
            await _controller.DisconnectAsync();
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, AppLogger.Redact(exception.Message), "Disconnect failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void BrowseWorkspace(object? sender, EventArgs eventArgs)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Select the root folder Remote Codex can access",
            SelectedPath = Directory.Exists(_workspaceTextBox.Text)
                ? _workspaceTextBox.Text
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ShowNewFolderButton = true,
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _workspaceTextBox.Text = dialog.SelectedPath;
        }
    }

    private void ControllerChanged(object? sender, EventArgs eventArgs)
    {
        if (IsDisposed)
        {
            return;
        }
        if (InvokeRequired)
        {
            BeginInvoke(UpdateState);
        }
        else
        {
            UpdateState();
        }
    }

    private void UpdateState()
    {
        var (title, detail, color) = _controller.State switch
        {
            SupervisorState.Running => ("Supervisor running", "The outbound Relay tunnel is maintained in the background.", OnlineColor),
            SupervisorState.Starting => ("Connecting device", _controller.Progress.Message, AccentColor),
            SupervisorState.Stopped => ("Device offline", "Paste a device setup command, then start this Windows computer.", Color.FromArgb(100, 116, 139)),
            SupervisorState.Error => ("Connection needs attention", _controller.LastError ?? _controller.Progress.Message, ErrorColor),
            _ => ("Checking status", "Waiting for the local supervisor.", Color.FromArgb(148, 163, 184)),
        };
        _statusTitle.Text = title;
        _statusDetail.Text = detail;
        _statusDot.BackColor = color;
        _stepLabel.Text = $"{_controller.Progress.Step}: {_controller.Progress.Message}";
        _progressBar.Value = Math.Clamp(_controller.Progress.Percent, 0, 100);
        _connectButton.Text = "Start";
        _connectButton.Enabled = !_controller.IsBusy;
        _disconnectButton.Enabled = !_controller.IsBusy && _controller.State == SupervisorState.Running;
        _relayUrlTextBox.Enabled = !_controller.IsBusy;
        _tokenTextBox.Enabled = !_controller.IsBusy;
        _workspaceTextBox.Enabled = !_controller.IsBusy;
        _portInput.Enabled = !_controller.IsBusy;
        _startWithWindowsCheckBox.Enabled = !_controller.IsBusy;
        _pasteConfigurationTextBox.Enabled = !_controller.IsBusy;
        _checkUpdateButton.Enabled = !_controller.IsBusy && _controller.Runtime?.IsUsable == true;
        _updateButton.Enabled = !_controller.IsBusy
            && _controller.Runtime?.IsUsable == true
            && !string.IsNullOrWhiteSpace(_controller.AvailableRemoteCodexVersion);
        _tokenStateLabel.Text = _controller.HasSavedToken
            ? "A token is configured. Leave this blank to keep it."
            : "Paste the one-time-visible token from the Relay portal.";
        _runtimeValue.Text = _controller.Runtime?.IsUsable == true
            ? $"Node.js 22  |  Codex  |  codex-acp  |  Remote Codex {_controller.CurrentRemoteCodexVersion}"
            : "Node.js, Codex, codex-acp and Remote Codex will be checked on connect.";
        _runtimeUpdateLabel.Text = _controller.RuntimeUpdateMessage;
    }

    private static TextBox CreateTextBox() => new()
    {
        Dock = DockStyle.Fill,
        Margin = new Padding(0, 0, 0, 6),
    };

    private static Button CreateNeutralButton(string text, int width)
    {
        var button = new Button
        {
            AutoSize = false,
            BackColor = WindowColor,
            FlatStyle = FlatStyle.Flat,
            ForeColor = TextColor,
            Size = new Size(width, 36),
            Text = text,
        };
        button.FlatAppearance.BorderColor = BorderColor;
        button.FlatAppearance.MouseOverBackColor = SurfaceColor;
        return button;
    }

    private static void AddField(
        TableLayoutPanel grid,
        string labelText,
        Control control,
        int row,
        bool spanRemainingColumns = true)
    {
        grid.Controls.Add(new Label
        {
            AutoSize = true,
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 5, 12, 0),
            Text = labelText,
        }, 0, row);
        grid.Controls.Add(control, 1, row);
        if (spanRemainingColumns)
        {
            grid.SetColumnSpan(control, 2);
        }
    }
}
