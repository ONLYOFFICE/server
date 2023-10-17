const platforms = {
  'win32': 'windows',
  'darwin': 'mac',
  'linux': 'linux'
};
const platform = platforms[process.platform];

process.env.NODE_ENV = `development-${platform}`;
process.env.NODE_CONFIG_DIR = '../Common/config';

if (platform === 'mac') {
  process.env.DYLD_LIBRARY_PATH = '../FileConverter/bin/';
} else if (platform === 'linux') {
  process.env.LD_LIBRARY_PATH = '../FileConverter/bin/';
}