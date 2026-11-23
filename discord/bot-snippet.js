/**
 * Drop-in Discord.js snippet for ENVLOGGER
 *
 * Requires: discord.js v14+, Node 18+, luau binary, this repo checked out.
 *
 * Slash command: /envlog  (attachment or url)
 * Replies with a short summary + full report as a .txt attachment.
 */

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point at your clone of https://github.com/Zain20m/envlogger
const ENVLOGGER_ROOT = process.env.ENVLOGGER_ROOT || path.join(__dirname, '..');
const RUNNER = path.join(ENVLOGGER_ROOT, 'src', 'run.js');

function runEnvLogger({ filePath, url, budget = 20 }) {
  return new Promise((resolve, reject) => {
    const args = [RUNNER];
    if (url) args.push('--url', url);
    else args.push(filePath);
    args.push('--budget', String(budget), '--json');

    const outFile = path.join(os.tmpdir(), `envlog-${Date.now()}.txt`);
    args.push('-o', outFile);

    const child = spawn(process.execPath, args, {
      env: { ...process.env, ENVLOGGER_ROOT },
      timeout: (budget + 20) * 1000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      let summary = {};
      try {
        summary = JSON.parse(stdout || '{}');
      } catch (_) {}
      const report = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : stdout || stderr;
      resolve({ code, summary, report, outFile, stderr });
    });
    child.on('error', reject);
  });
}

// --- Slash command definition ---
const envlogCommand = new SlashCommandBuilder()
  .setName('envlog')
  .setDescription('Run ENVLOGGER on an obfuscated Luau/Lua script')
  .addAttachmentOption((o) =>
    o.setName('file').setDescription('Lua/Luau file to analyze').setRequired(false)
  )
  .addStringOption((o) =>
    o.setName('url').setDescription('Raw URL to a Lua/Luau file').setRequired(false)
  )
  .addIntegerOption((o) =>
    o.setName('budget').setDescription('Time budget seconds (default 20)').setRequired(false)
  );

// --- Handler ---
async function handleEnvlog(interaction) {
  const file = interaction.options.getAttachment('file');
  const url = interaction.options.getString('url');
  const budget = interaction.options.getInteger('budget') || 20;

  if (!file && !url) {
    await interaction.reply({ content: 'Provide a **file** or **url**.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  let filePath = null;
  try {
    if (file) {
      const res = await fetch(file.url);
      const text = await res.text();
      filePath = path.join(os.tmpdir(), `envlog-in-${Date.now()}.lua`);
      fs.writeFileSync(filePath, text, 'utf8');
    }

    const result = await runEnvLogger({ filePath, url, budget });
    const s = result.summary || {};
    const summaryText = [
      '**ENVLOGGER**',
      `status: \`${s.status || '?'}\` · stmts: \`${s.stmts ?? '?'}\` · bytes: \`${s.bytes ?? '?'}\``,
      s.urls?.length ? `urls: ${s.urls.slice(0, 5).map((u) => `\`${u}\``).join(', ')}` : null,
      s.remotes?.length ? `remotes: ${s.remotes.length}` : null,
      s.loadstrings?.length ? `loadstring captures: ${s.loadstrings.length}` : null,
      s.errors?.length ? `errors: ${s.errors.slice(0, 2).join(' | ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const attachment = new AttachmentBuilder(Buffer.from(result.report || '', 'utf8'), {
      name: 'envlogger-report.txt',
    });

    await interaction.editReply({ content: summaryText, files: [attachment] });
  } catch (err) {
    await interaction.editReply({ content: `ENVLOGGER failed: \`${String(err.message || err)}\`` });
  } finally {
    if (filePath) try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

module.exports = { envlogCommand, handleEnvlog, runEnvLogger };
