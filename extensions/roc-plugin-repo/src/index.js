import fs from 'fs';
import * as validators from 'roc/validators';
import log from 'roc/log/default/small';
import readPkg from 'read-pkg';
import { lazyFunctionRequire, generateDependencies } from 'roc';
import glob from 'glob';
import chalk from 'chalk';
import resolveFrom from 'resolve-from';

import { invokeHook, packageJSON } from './util';
import { config, meta } from './config';

const lazyRequire = lazyFunctionRequire(require);

function getProjects(baseDirectory, directory) {
  if (!fs.existsSync(`${baseDirectory}/${directory}`)) {
    return [];
  }

  return fs
    .readdirSync(`${baseDirectory}/${directory}`)
    .map(project => {
      if (
        fs.existsSync(`${baseDirectory}/${directory}/${project}/package.json`)
      ) {
        const path = `${baseDirectory}/${directory}/${project}`;
        const pkgJSON = readPkg.sync(`${path}/package.json`);
        return {
          folder: project,
          directory,
          path,
          name: pkgJSON.name,
          packageJSON: pkgJSON,
          rawPackageJSON: require(`${path}/package.json`),
        };
      }
      return undefined;
    })
    .filter(project => project !== undefined);
}

function fetchProjects(command) {
  return command(invokeHook('get-projects'));
}

const jestOptions = require(resolveFrom(
  require.resolve('jest'),
  'jest-cli/build/cli/args',
)).options;

Object.keys(jestOptions).forEach(key => {
  if (jestOptions[key].type === 'boolean') {
    jestOptions[key].validator = validators.isBoolean;
  } else if (jestOptions[key].type === 'string') {
    jestOptions[key].validator = validators.isString;
  } else if (jestOptions[key].type === 'array') {
    jestOptions[key].validator = validators.isArray(validators.isPath);
  }
  // Remove aliases that are used by Roc to avoid collisions
  if (['b', 'c', 'd', 'h', 'V', 'v'].indexOf(jestOptions[key].alias) > -1) {
    jestOptions[key].alias = undefined;
  }
});

module.exports.roc = {
  dependencies: {
    uses: generateDependencies(packageJSON, ['babel-preset-env']),
    requires: {
      jest: '^21.2.1 || ^22.0.0',
    },
  },
  plugins: [require.resolve('roc-plugin-babel')],
  hooks: {
    'run-script': {
      description:
        'Invoked for build, clean, lint, release and test making it possible to customize what is done and extend existing functionality, the functions can return a promise.',
      hasCallback: true,
      returns: validators.oneOf(
        validators.isFunction,
        validators.isArray(validators.isFunction),
      ),
      arguments: {
        script: {
          validator: validators.isString,
          description:
            'The script that has been invoked, can be either `build`, `clean`, `lint`, `release` or `test`.',
        },
        projects: {
          validator: validators.isArray(validators.isObject()),
          description: 'The projects that the script has been invoked for.',
        },
        extra: {
          description:
            'Additional arguments containing `options`, `extraArguments` from the command as well as `createLogger` that takes a name and returns a function that can be used for logging',
          validator: validators.isObject(),
        },
      },
    },
    'get-projects': {
      description: 'Gets all projects.',
      returns: validators.isArray(validators.isObject()),
    },
    'babel-config': {
      description: 'Used to create a Babel configuration to be used.',
      initialValue: {},
      returns: validators.isObject(),
      arguments: {
        target: {
          validator: validators.isString,
          description: 'The target, will by default be either "cjs" or "esm".',
        },
      },
    },
    'release-preconditions': {
      description: 'Release preconditions.',
      initialValue: [],
      arguments: {
        toRelease: {
          description: 'Projects that will be released',
          validator: validators.isArray(validators.isString),
        },
        Listr: {
          description: 'Listr instance',
        },
      },
    },
    'release-after-build': {
      description: 'Extra tasks to do before releasing, after building.',
      initialValue: [],
      arguments: {
        toRelease: {
          description: 'Projects that will be released',
          validator: validators.isArray(validators.isString),
        },
        Listr: {
          description: 'Listr instance',
        },
      },
    },
  },
  actions: [
    {
      hook: 'run-script',
      action: lazyRequire('./actions/runScript'),
    },
    {
      hook: 'get-projects',
      action: ({
        context: { directory, config: { settings } },
      }) => () => () => {
        if (settings.repo.mono === false) {
          if (fs.existsSync(`${directory}/package.json`)) {
            const pkgJSON = readPkg.sync(`${directory}/package.json`);
            return [
              {
                folder: directory,
                path: directory,
                name: pkgJSON.name,
                packageJSON: pkgJSON,
                rawPackageJSON: require(`${directory}/package.json`),
              },
            ];
          }

          return [];
        }

        // Look for things in either of these directories
        return settings.repo.mono.reduce((previous, dir) => {
          const explodedPaths = glob.sync(dir, {
            cwd: directory,
          });
          return previous.concat(
            explodedPaths.reduce(
              (prev, d) => prev.concat(getProjects(directory, d)),
              [],
            ),
          );
        }, []);
      },
    },
    {
      hook: 'babel-config',
      description:
        'Adds babel-preset-latest with either modules enabled or not depending on the target',
      action: ({
        context: { config: { settings: { repo } } },
      }) => target => babelConfig =>
        Object.assign({}, babelConfig, {
          presets:
            target === 'cjs'
              ? [
                  ...babelConfig.presets,
                  [require.resolve('babel-preset-env'), repo.babelPresetEnv],
                  require.resolve('babel-preset-stage-3'),
                ]
              : [
                  [
                    require.resolve('babel-preset-env'),
                    { ...repo.babelPresetEnv, modules: false },
                  ],
                  require.resolve('babel-preset-stage-3'),
                  ...babelConfig.presets,
                ],
        }),
    },
  ],
  config,
  meta,
  commands: {
    repo: {
      bootstrap: {
        command: args =>
          fetchProjects(lazyRequire('./commands/bootstrap'))(args),
        description: 'Installs and links the projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          linkAll: {
            validator: validators.isBoolean,
            description:
              'If all projects should be linked with each other, ignoring SemVer ranges',
            default: false,
          },
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: 2,
          },
          prerelease: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isString,
            ),
            default: false,
            description:
              'If a prerelease should be done, and what name that should be used for the tag, will default to "alpha"',
          },
        },
      },
      build: {
        command: args => fetchProjects(lazyRequire('./commands/build'))(args),
        description: 'Builds projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: 2,
          },
          watch: {
            validator: validators.isBoolean,
            description: 'Enabled watch mode',
            alias: 'w',
          },
        },
      },
      clean: {
        command: args => fetchProjects(lazyRequire('./commands/clean'))(args),
        description: 'Cleans generated files',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: false,
          },
        },
      },
      commit: {
        command: lazyRequire('./commands/commit'),
        description:
          'Use commitizen when doing a commit, pass arguments with --',
        settings: true,
      },
      exec: {
        command: args => fetchProjects(lazyRequire('./commands/exec'))(args),
        description:
          'Run an arbitrary command in each project, will invoke what comes after --',
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: false,
          },
        },
      },
      graph: {
        command: args => fetchProjects(lazyRequire('./commands/graph'))(args),
        description: 'Shows how the projects are connected with each other',
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          prerelease: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isString,
            ),
            default: false,
            description:
              'If a prerelease should be done, and what name that should be used for the tag, will default to "alpha"',
          },
        },
      },
      import: {
        command: args => fetchProjects(lazyRequire('./commands/import'))(args),
        arguments: {
          repository: {
            validator: validators.required(
              validators.notEmpty(validators.isString),
            ),
            description: 'Repository to import from',
          },
          location: {
            validator: validators.isString,
            description: 'Where to expand the repository',
          },
        },
        options: {
          merge: {
            validator: validators.isBoolean,
            description:
              'If a merge strategy should be used when importing a repository',
            default: false,
          },
          prefix: {
            validator: validators.isBoolean,
            description:
              'If commits should be prefixed with the project name for each commit, ignored when using merge',
            default: false,
          },
          flatten: {
            validator: validators.isBoolean,
            default: false,
            description:
              'Import each merge commit as a single change the merge introduced, ignored when using merge',
          },
          subdirectory: {
            validator: validators.isString,
            description: 'Import only a given subdirectory from the repository',
          },
        },
      },
      lint: {
        command: args => fetchProjects(lazyRequire('./commands/lint'))(args),
        description: 'Runs lint',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: false,
          },
          fix: {
            validator: validators.isBoolean,
            description: 'Use ESLint --fix option',
          },
          forceDefault: {
            validator: validators.isBoolean,
            description: 'Force use of default ESLint configuration',
            default: false,
          },
        },
      },
      list: {
        description:
          'List the projects that will be used when running the commands',
        settings: true,
        command: () =>
          fetchProjects(projects => {
            if (projects.length === 0) {
              return log.log('Nothing found.');
            }

            return log.log(
              `Found the following:\n${projects
                .map(
                  project =>
                    ` — ${chalk.bold(project.name)} (${project.packageJSON
                      .version})${project.packageJSON.private
                      ? ` ${chalk.yellow('Private')}`
                      : ''} ${project.directory
                      ? chalk.dim(`${project.directory}/${project.folder}`)
                      : ''}`,
                )
                .join('\n')}`,
            );
          }),
      },
      release: {
        command: args => fetchProjects(lazyRequire('./commands/release'))(args),
        description: 'Perform a release',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          automatic: {
            validator: validators.isBoolean,
            default: false,
            description:
              'If an automated release should be performed, useful for CI environments',
          },
          prerelease: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isString,
            ),
            default: false,
            description:
              'If a prerelease should be done, and what name that should be used for the tag, will default to "alpha"',
          },
          clean: {
            validator: validators.isBoolean,
            default: true,
            description: 'If the project should be cleaned',
          },
          'dist-tag': {
            validator: validators.isString,
            default: 'latest',
            description: 'dist-tag to be used when publishing to npm',
          },
          git: {
            validator: validators.isBoolean,
            default: true,
            description: 'If project commits should be created',
          },
          'git-name': {
            validator: validators.isString,
            description: 'Name to use for Git author over the default',
          },
          'git-email': {
            validator: validators.isString,
            description: 'Email to use for Git author over the default',
          },
          from: {
            validator: validators.isString,
            description:
              'Manually specify from which commit the status generation should be performed, by default all commits',
            default: undefined,
          },
          push: {
            validator: validators.isBoolean,
            default: true,
            description: 'If commits should be pushed to the remote',
          },
          publish: {
            validator: validators.isBoolean,
            default: true,
            description: 'If projects should be published',
          },
          tag: {
            default: true,
            validator: validators.isBoolean,
            description: 'If git tags should be created',
          },
          github: {
            default: true,
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isString,
            ),
            description:
              'If a GitHub release should be made, will read from GITHUB_AUTH if true or use the value provided to the option',
          },
          draft: {
            default: true,
            validator: validators.isBoolean,
            description:
              'If the GitHub release should be done as a draft or not',
          },
        },
      },
      rnm: {
        command: args =>
          fetchProjects(lazyRequire('./commands/removeNodeModules'))(args),
        description: 'Removes node_modules folders in projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
      },
      run: {
        command: args => fetchProjects(lazyRequire('./commands/run'))(args),
        description: 'Run npm scripts in projects.',
        arguments: {
          command: {
            validator: validators.isString,
            description: 'The command to invoke',
          },
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          list: {
            description: 'Lists possible commands',
            default: false,
            validator: validators.isBoolean,
          },
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: false,
          },
        },
        settings: ['mono'],
      },
      status: {
        command: args => fetchProjects(lazyRequire('./commands/status'))(args),
        description: 'Generate status about release state for projects',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          prerelease: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isString,
            ),
            default: false,
            description:
              'If a prerelease should be done, and what name that should be used for the tag, will default to "alpha"',
          },
          from: {
            validator: validators.isString,
            description:
              'Manually specify from which commit the status generation should be performed, by default all commits',
            default: undefined,
          },
        },
      },
      test: {
        command: args => fetchProjects(lazyRequire('./commands/test'))(args),
        description: 'Run tests using Jest',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: jestOptions,
      },
      watch: {
        command: args => fetchProjects(lazyRequire('./commands/watch'))(args),
        description: 'Build projects in watch mode',
        settings: true,
        arguments: {
          projects: {
            validator: validators.isArray(validators.isString),
            description: 'Projects to use',
          },
        },
        options: {
          concurrent: {
            validator: validators.oneOf(
              validators.isBoolean,
              validators.isInteger,
            ),
            description: 'Run concurrently',
            default: 2,
          },
        },
      },
    },
  },
};
