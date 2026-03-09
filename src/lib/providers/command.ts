import { spawn } from 'child_process';
import { SCRIPT_DIR } from '../config';

export async function runCommand(
    command: string,
    args: string[],
    cwd?: string,
    envOverrides?: Record<string, string>,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => reject(error));
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}
