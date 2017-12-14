import resolveFrom from 'resolve-from';
import jest from 'jest'; // eslint-disable-line import/no-extraneous-dependencies
import yargs from 'yargs';

const jestCli = require(resolveFrom(
  require.resolve('jest'),
  'jest-cli/build/cli/args',
));

export default (context, projects, { options, extraArguments }) => {
  // Enforce test
  process.env.NODE_ENV = 'test';

  process.env.ROC_INITAL_ARGV = JSON.stringify(process.argv);

  const jestConfig = {
    resolver: require.resolve('../commands/utils/jest/roc-resolver.js'),
    testPathIgnorePatterns: projects.map(
      ({ path }) =>
        `${path}/(${context.config.settings.repo.output}|node_modules)/`,
    ),
    transform: {
      '^.+\\.js$': require.resolve(
        '../commands/utils/jest/babel-jest-transformer.js',
      ),
    },
    testMatch: [].concat(
      ...projects.map(({ path }) =>
        context.config.settings.repo.test.map(pattern => `${path}/${pattern}`),
      ),
    ),
  };

  // Parse extra arguments in the same way as Jest does
  const jestArgv = yargs(extraArguments).options(jestCli.options).argv;
  const jestOptions = {
    ...options,
    ...jestArgv,
  };

  Object.keys(jestOptions).forEach(
    key => jestOptions[key] === undefined && delete jestOptions[key],
  );

  // Verify the options
  jestCli.check(jestOptions);

  return () =>
    jest
      .runCLI(
        {
          ...jestOptions,
          // We don't want to fail if there are no tests currently
          passWithNoTests: true,
          config: JSON.stringify(jestConfig),
        },
        [context.directory],
      )
      .then(
        ({ results }) =>
          results && results.success
            ? Promise.resolve(results)
            : Promise.reject(
                new Error(
                  results.testResults
                    .map(({ failureMessage }) => failureMessage)
                    .join(''),
                ),
              ),
      );
};