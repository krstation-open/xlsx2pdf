/**
 * commitlint 配置：强制 Conventional Commits 规范
 * 提交格式：<type>(<scope>): <subject>
 */
export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat', // 新功能
                'fix', // 修复缺陷
                'docs', // 文档变更
                'style', // 代码格式（不影响逻辑）
                'refactor', // 重构（非新功能/非修复）
                'perf', // 性能优化
                'test', // 测试相关
                'build', // 构建系统或外部依赖变更
                'ci', // CI 配置变更
                'chore', // 其他杂项
                'revert' // 回滚
            ]
        ],
        // 允许中文主题，关闭大小写校验
        'subject-case': [0],
        'header-max-length': [2, 'always', 100],
        'type-empty': [2, 'never'],
        'subject-empty': [2, 'never']
    }
};
