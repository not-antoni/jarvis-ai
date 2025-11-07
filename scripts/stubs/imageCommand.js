import { Constants } from 'oceanic.js';

class ImageCommand {
  static description = '';
  static aliases = [];
  static command = '';
  static requiresImage = true;
  static requiresParam = false;
  static requiredParam = 'text';
  static requiredParamType = Constants.ApplicationCommandOptionTypes.STRING;
  static textOptional = false;
  static requiresAnim = false;
  static alwaysGIF = false;
  static flags = [];

  static init() {
    this.flags = [];
    return this;
  }

  static addTextParam() {
    this.flags.unshift({
      name: 'text',
      description: 'Text to display',
      type: Constants.ApplicationCommandOptionTypes.STRING,
      required: !this.textOptional
    });
  }
}

export default ImageCommand;
