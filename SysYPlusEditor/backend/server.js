const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/api/runSysYPlus', (req, res) => {
  const code = req.body.code;
  const filename = 'temp.syy';
  fs.writeFileSync(filename, code);

  // 假设 sysyplus.exe 是你的编译器，输出到 temp.out
  exec('sysyplus.exe temp.syy -o temp.out && temp.out', (error, stdout, stderr) => {
    if (error) {
      res.json({ error: stderr || error.message });
    } else {
      res.json({ output: stdout });
    }
    // 清理临时文件
    fs.unlinkSync(filename);
    if (fs.existsSync('temp.out')) fs.unlinkSync('temp.out');
  });
});

app.listen(3001, () => {
  console.log('SysY+ 后端服务已启动，端口 3001');
});
