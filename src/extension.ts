'use strict';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ctags from './ctags';
import * as util from './util';

const tagsfile = '.vscode-ctags';
let tags: ctags.CTags;

class CTagsDefinitionProvider implements vscode.DefinitionProvider {
  public provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    const query = document.getText(document.getWordRangeAtPosition(position));
    return this.resolveDefinitions(query);
  }

  private async resolveDefinitions(query: string): Promise<vscode.Definition> {
    const matches = await tags.lookup(query);
    if (!matches) {
      util.log(`"${query}" has no matches.`);
      return [];
    }
    return matches.map(match => {
      util.log(`"${query}" matches ${match.path}:${match.lineno}`);
      return new vscode.Location(
        vscode.Uri.file(match.path),
        new vscode.Position(match.lineno, 0)
      );
    });
  }
}

function regenerateArgs(): string[] {
  const config = vscode.workspace.getConfiguration('ctags');
  const excludes = config
    .get<string[]>('excludePatterns', [])
    .map((pattern: string) => {
      return '--exclude=' + pattern;
    })
    .join(' ');
  const languages =
    '--languages=' + config.get<string[]>('languages', ['all']).join(',');
  return [languages, excludes];
}

function regenerateCTags() {
  const args = regenerateArgs();
  const title =
    args && args.length
      ? `Generating CTags index (${args.join(' ')})`
      : 'Generating CTags index';
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title
    },
    (progress, token) => {
      return tags.regenerate(regenerateArgs()).catch(err => {
        vscode.window.setStatusBarMessage('Generating CTags failed: ' + err);
      });
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  util.log('extension activated.');

  tags = new ctags.CTags(vscode.workspace.rootPath || '', tagsfile);
  tags
    .reindex()
    .then(() => {
      vscode.window.setStatusBarMessage('CTags index loaded', 2000);
    })
    .catch(() => {
      return regenerateCTags();
    });

  const definitionsProvider = new CTagsDefinitionProvider();
  vscode.languages.registerDefinitionProvider(
    { scheme: 'file', language: 'cpp' },
    definitionsProvider
  );
  vscode.languages.registerDefinitionProvider(
    { scheme: 'file', language: 'c' },
    definitionsProvider
  );

  const regenerateCTagsCommand = vscode.commands.registerCommand(
    'extension.regenerateCTags',
    () => {
      regenerateCTags();
    }
  );

  context.subscriptions.push(regenerateCTagsCommand);

  vscode.workspace.onDidSaveTextDocument(event => {
    util.log('saved', event.fileName, event.languageId);
    const config = vscode.workspace.getConfiguration('ctags');
    const autoRegenerate = config.get<boolean>('regenerateOnSave');
    if (autoRegenerate) {
      regenerateCTags();
    }
  });
}

export function deactivate() {}
