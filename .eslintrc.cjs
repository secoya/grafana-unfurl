require('@rushstack/eslint-patch/modern-module-resolution');
module.exports = {
	extends: ['plugin:@secoya/orbit/nodeService'],
	parserOptions: {
		tsconfigRootDir: __dirname,
	},
};
