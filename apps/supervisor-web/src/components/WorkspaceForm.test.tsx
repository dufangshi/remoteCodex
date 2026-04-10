import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceForm } from './WorkspaceForm';

describe('WorkspaceForm', () => {
  it('requires a path before submit', async () => {
    const onSubmit = vi.fn();
    render(<WorkspaceForm onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /save workspace/i }));

    expect(await screen.findByText(/absolute path is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed input', async () => {
    const onSubmit = vi.fn();
    render(<WorkspaceForm submitLabel="Create Workspace" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/absolute path/i), {
      target: { value: '  /tmp/project  ' }
    });
    fireEvent.change(screen.getByLabelText(/display label/i), {
      target: { value: '  Demo  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        absPath: '/tmp/project',
        label: 'Demo'
      });
    });
  });

  it('autofills the label from the last path segment and keeps manual overrides', async () => {
    const onSubmit = vi.fn();
    render(<WorkspaceForm onSubmit={onSubmit} />);

    const pathInput = screen.getByLabelText(/absolute path/i);
    const labelInput = screen.getByLabelText(/display label/i);

    fireEvent.change(pathInput, {
      target: { value: '/Users/fonsh/Desktop/remoteCodex' }
    });
    expect(labelInput).toHaveValue('remoteCodex');

    fireEvent.change(labelInput, {
      target: { value: 'Custom Name' }
    });
    fireEvent.change(pathInput, {
      target: { value: '/Users/fonsh/Desktop/another-project' }
    });

    expect(labelInput).toHaveValue('Custom Name');
  });
});
