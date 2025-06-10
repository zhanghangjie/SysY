// 这是一个测试文件，用于演示代码修复和重构功能

// 1. 测试快速修复功能
// 下面的代码包含一些常见问题：
// - 未使用的变量
// - 重复的导入（已修复，这是之前的问题示例）
// - 不必要的 else
import { readFileSync } from 'fs';  // 这行导入之前是重复的

function calculateTotal(items: number[]) {
    const unusedVariable = 'test';  // 未使用的变量
    
    let total = 0;
    if (items.length > 0) {
        for (const item of items) {
            total += item;
        }
    } else {
        return 0;  // 不必要的 else
    }
    return total;
}

// 2. 测试提取变量功能
// 选择复杂表达式并提取为变量
function getDiscountedPrice(price: number, discount: number) {
    return price - (price * discount / 100) + (price * 0.1);  // 选择 (price * discount / 100) 提取为变量
}

// 3. 测试重命名功能
// 将光标放在 oldName 上，使用重命名功能
function oldName() {
    console.log('This function needs a better name');
}

// 4. 综合示例
class UserService {
    private users = [
        { id: 1, name: 'John', age: 30 },
        { id: 2, name: 'Jane', age: 25 }
    ];

    // 选择表达式提取为变量
    getUserById(id: number) {
        return this.users.find(user => user.id === id && user.age > 20 && user.name.length > 0);
    }

    // 包含可以修复的问题
    processUser(user: any) {  // 使用 any 类型
        const temp = 'temporary';  // 未使用的变量
        if (user) {
            console.log(user.name);
        } else {
            return;  // 不必要的 return
        }
    }
} 