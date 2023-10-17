// MIT License
// 
// Copyright (c) 2019 Three Planets Software
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export const descriptor: any = {
	'nested': {
		'ciofecaforensics': {
			'nested': {
				'Color': {
					'fields': {
						'red': {
							'type': 'float',
							'id': 1
						},
						'green': {
							'type': 'float',
							'id': 2
						},
						'blue': {
							'type': 'float',
							'id': 3
						},
						'alpha': {
							'type': 'float',
							'id': 4
						}
					}
				},
				'AttachmentInfo': {
					'fields': {
						'attachmentIdentifier': {
							'type': 'string',
							'id': 1
						},
						'typeUti': {
							'type': 'string',
							'id': 2
						}
					}
				},
				'Font': {
					'fields': {
						'fontName': {
							'type': 'string',
							'id': 1
						},
						'pointSize': {
							'type': 'float',
							'id': 2
						},
						'fontHints': {
							'type': 'int32',
							'id': 3
						}
					}
				},
				'ParagraphStyle': {
					'fields': {
						'styleType': {
							'type': 'int32',
							'id': 1,
							'options': {
								'default': -1
							}
						},
						'alignment': {
							'type': 'int32',
							'id': 2
						},
						'indentAmount': {
							'type': 'int32',
							'id': 4
						},
						'checklist': {
							'type': 'Checklist',
							'id': 5
						},
						'blockquote': {
							'type': 'int32',
							'id': 8
						}
					}
				},
				'Checklist': {
					'fields': {
						'uuid': {
							'type': 'bytes',
							'id': 1
						},
						'done': {
							'type': 'int32',
							'id': 2
						}
					}
				},
				'DictionaryElement': {
					'fields': {
						'key': {
							'type': 'ObjectID',
							'id': 1
						},
						'value': {
							'type': 'ObjectID',
							'id': 2
						}
					}
				},
				'Dictionary': {
					'fields': {
						'element': {
							'rule': 'repeated',
							'type': 'DictionaryElement',
							'id': 1,
							'options': {
								'packed': false
							}
						}
					}
				},
				'ObjectID': {
					'fields': {
						'unsignedIntegerValue': {
							'type': 'uint64',
							'id': 2
						},
						'stringValue': {
							'type': 'string',
							'id': 4
						},
						'objectIndex': {
							'type': 'int32',
							'id': 6
						}
					}
				},
				'RegisterLatest': {
					'fields': {
						'contents': {
							'type': 'ObjectID',
							'id': 2
						}
					}
				},
				'MapEntry': {
					'fields': {
						'key': {
							'type': 'int32',
							'id': 1
						},
						'value': {
							'type': 'ObjectID',
							'id': 2
						}
					}
				},
				'AttributeRun': {
					'fields': {
						'length': {
							'type': 'int32',
							'id': 1
						},
						'paragraphStyle': {
							'type': 'ParagraphStyle',
							'id': 2
						},
						'font': {
							'type': 'Font',
							'id': 3
						},
						'fontWeight': {
							'type': 'int32',
							'id': 5
						},
						'underlined': {
							'type': 'int32',
							'id': 6
						},
						'strikethrough': {
							'type': 'int32',
							'id': 7
						},
						'superscript': {
							'type': 'int32',
							'id': 8
						},
						'link': {
							'type': 'string',
							'id': 9
						},
						'color': {
							'type': 'Color',
							'id': 10
						},
						'attachmentInfo': {
							'type': 'AttachmentInfo',
							'id': 12
						}
					}
				},
				'NoteStoreProto': {
					'fields': {
						'document': {
							'type': 'Document',
							'id': 2
						}
					}
				},
				'Document': {
					'fields': {
						'version': {
							'type': 'int32',
							'id': 2
						},
						'note': {
							'type': 'Note',
							'id': 3
						}
					}
				},
				'Note': {
					'fields': {
						'noteText': {
							'type': 'string',
							'id': 2
						},
						'attributeRun': {
							'rule': 'repeated',
							'type': 'AttributeRun',
							'id': 5,
							'options': {
								'packed': false
							}
						}
					}
				},
				'MergableDataProto': {
					'fields': {
						'mergableDataObject': {
							'type': 'MergableDataObject',
							'id': 2
						}
					}
				},
				'MergableDataObject': {
					'fields': {
						'version': {
							'type': 'int32',
							'id': 2
						},
						'mergeableDataObjectData': {
							'type': 'MergeableDataObjectData',
							'id': 3
						}
					}
				},
				'MergeableDataObjectData': {
					'fields': {
						'mergeableDataObjectEntry': {
							'rule': 'repeated',
							'type': 'MergeableDataObjectEntry',
							'id': 3,
							'options': {
								'packed': false
							}
						},
						'mergeableDataObjectKeyItem': {
							'rule': 'repeated',
							'type': 'string',
							'id': 4
						},
						'mergeableDataObjectTypeItem': {
							'rule': 'repeated',
							'type': 'string',
							'id': 5
						},
						'mergeableDataObjectUuidItem': {
							'rule': 'repeated',
							'type': 'bytes',
							'id': 6
						}
					}
				},
				'MergeableDataObjectEntry': {
					'fields': {
						'registerLatest': {
							'type': 'RegisterLatest',
							'id': 1
						},
						'list': {
							'type': 'List',
							'id': 5
						},
						'dictionary': {
							'type': 'Dictionary',
							'id': 6
						},
						'unknownMessage': {
							'type': 'UnknownMergeableDataObjectEntryMessage',
							'id': 9
						},
						'note': {
							'type': 'Note',
							'id': 10
						},
						'customMap': {
							'type': 'MergeableDataObjectMap',
							'id': 13
						},
						'orderedSet': {
							'type': 'OrderedSet',
							'id': 16
						}
					}
				},
				'UnknownMergeableDataObjectEntryMessage': {
					'fields': {
						'unknownEntry': {
							'type': 'UnknownMergeableDataObjectEntryMessageEntry',
							'id': 1
						}
					}
				},
				'UnknownMergeableDataObjectEntryMessageEntry': {
					'fields': {
						'unknownInt1': {
							'type': 'int32',
							'id': 1
						},
						'unknownInt2': {
							'type': 'int64',
							'id': 2
						}
					}
				},
				'MergeableDataObjectMap': {
					'fields': {
						'type': {
							'type': 'int32',
							'id': 1
						},
						'mapEntry': {
							'rule': 'repeated',
							'type': 'MapEntry',
							'id': 3,
							'options': {
								'packed': false
							}
						}
					}
				},
				'OrderedSet': {
					'fields': {
						'ordering': {
							'type': 'OrderedSetOrdering',
							'id': 1
						},
						'elements': {
							'type': 'Dictionary',
							'id': 2
						}
					}
				},
				'OrderedSetOrdering': {
					'fields': {
						'array': {
							'type': 'OrderedSetOrderingArray',
							'id': 1
						},
						'contents': {
							'type': 'Dictionary',
							'id': 2
						}
					}
				},
				'OrderedSetOrderingArray': {
					'fields': {
						'contents': {
							'type': 'Note',
							'id': 1
						},
						'attachment': {
							'rule': 'repeated',
							'type': 'OrderedSetOrderingArrayAttachment',
							'id': 2,
							'options': {
								'packed': false
							}
						}
					}
				},
				'OrderedSetOrderingArrayAttachment': {
					'fields': {
						'index': {
							'type': 'int32',
							'id': 1
						},
						'uuid': {
							'type': 'bytes',
							'id': 2
						}
					}
				},
				'List': {
					'fields': {
						'listEntry': {
							'rule': 'repeated',
							'type': 'ListEntry',
							'id': 1,
							'options': {
								'packed': false
							}
						}
					}
				},
				'ListEntry': {
					'fields': {
						'id': {
							'type': 'ObjectID',
							'id': 2
						},
						'details': {
							'type': 'ListEntryDetails',
							'id': 3
						},
						'additionalDetails': {
							'type': 'ListEntryDetails',
							'id': 4
						}
					}
				},
				'ListEntryDetails': {
					'fields': {
						'listEntryDetailsKey': {
							'type': 'ListEntryDetailsKey',
							'id': 1
						},
						'id': {
							'type': 'ObjectID',
							'id': 2
						}
					}
				},
				'ListEntryDetailsKey': {
					'fields': {
						'listEntryDetailsTypeIndex': {
							'type': 'int32',
							'id': 1
						},
						'listEntryDetailsKey': {
							'type': 'int32',
							'id': 2
						}
					}
				}
			}
		}
	}
};
