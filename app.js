var fs = require("fs"),
	http = require("http"),
	zlib = require("zlib"),
	path = require("path"),
	url = require("url");

var exports = {};

var cacheDir = path.resolve("cache"),
	tempDir = path.resolve("temp");

var sourcesList = path.resolve("sources.list");

var arch = "amd64";

function httpGet(url, cb, echo) {
	if (!echo) console.log("Downloading: " + url);
}

function httpDownloadToPath(url, path, cb, echo) {
	if (!echo) console.log("Downloading: " + url + " to path " + path);
	http.get(url, function (res) {
		var write = fs.createWriteStream(path, {end: false});
		res.pipe(write);
		res.on("end", function (c) {
			write.end();
			setTimeout(function () {
				cb(undefined); // a fix for the whole file not being writen to disk
			}, 100);
		});
	});
}

var decompressers = {
	".gz": function (content, callback) {
		zlib.gunzip(content, function (err, content) {
			callback(err, content);
		});
	},

	".bz2": function (content, callback) {
		zlib.unzip(content, function (err, content) {
			callback(err, content);
		});
	},

	".tar.gz": function (content, callback) {

	}
};

function decompress(filename, type, callback) {
	if (decompressers[type] === undefined) {
		callback(new Error("Decompresser not Found : " + type), undefined);
	} else {
		fs.readFile(filename, function (err, content) {
			if (err) {
				callback(err, undefined);
			} else {
				decompressers[type](content, function (err, content) {
					callback(err, content);
				});
			}
		});
	}
}

function getSourceName(sourceURL) {
	var urlParsed = url.parse(sourceURL);
	return urlParsed.host;
}

function parseSourcesList(content) {
	var ret = [];
	var lines = content.split('\n').map(function (i) {
		return i.trim();
	});
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (line.indexOf('#') === 0)	continue; // ignore comments
		if (line.length === 0)			continue; // don't care about empty lines
		var tokens = line.split(' ');
		if (tokens[0] !== "deb")		throw new Error("not a deb line");
		var baseURL = tokens[1];
		if (baseURL.lastIndexOf("/") !== baseURL.length - 1) {
			baseURL = baseURL + "/";
		}
		var distro = tokens[2];
		var repos = tokens.splice(3);
		repos.forEach(function (i) {
			ret.push({
				repoURL: baseURL,
				baseURL: baseURL + "dists/" + distro + "/" + i + "/",
				cacheFolder: path.join(getSourceName(baseURL), distro, i)
			});
		});
	}
	return ret;
}

function recurseMkdir(pth, cb) {
	fs.exists(pth, function (e) {
		if (e) {
			cb();
		} else {
			var newPath = pth.substring(0, pth.lastIndexOf("/"));
			fs.exists(pth.substring(0, pth.lastIndexOf("/")), function (e) {
				if (e) {
					console.log("Creating: " + pth);
					fs.mkdir(pth, function () {
						cb();
					});
				} else {
					recurseMkdir(newPath, function () {
						recurseMkdir(pth, function () {
							cb();
						});
					});
				}
			});
		}
	});
}

function createIfNotExist(dir, cb) {
	fs.exists(dir, function (e) {
		if (e) {
			cb();
		} else {
			recurseMkdir(dir, function (e) {
				if (e) throw e;
				cb();
			});
		}
	});
}

function cacheExists(cb) {
	createIfNotExist(cacheDir, cb);
}

function tempExists(cb) {
	createIfNotExist(tempDir, cb);
}

var specialKeys = {
	"Depends": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Recommends": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Suggests": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Task": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Conflicts": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Pre-Depends": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Breaks": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Provides": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Replaces": function (str) {
		return str.split(",").map(function (i) {
			return i.trim();
		});
	},

	"Filename": function (str, source) {
		var filename = str.substring(str.lastIndexOf("/") + 1);
		return {
			fullURL: source.repoURL + str,
			filename: filename
		};
	}
};

function parsePackageList(source, content, cb) {
	content = content.toString("utf8");
	var lines = content.split('\n');
	var ret = {
		source: source,
		packages: {}
	};
	var currentObj = {};
	var lastKey = null;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (line.length === 0) {
			if (currentObj["Package"] !== undefined) {
				currentObj["Repo"] = source.baseURL;
				ret.packages[currentObj["Package"]] = currentObj;
				currentObj = {};
			}
		} else {
			var key = line.substring(0, line.indexOf(": "));
			var value = line.substring(line.indexOf(": ") + 2);
			if (specialKeys[key] !== undefined) {
				value = specialKeys[key](value, source);
			}
			if (key.length === 0) {
				key = lastKey;
				if (currentObj[key] instanceof Array) {
					var tmpValue = value;
					value = currentObj[key];
					value.push(tmpValue);
				} else {
					value = [currentObj[key], value];
				}
				currentObj[key] = value;
			} else {
				currentObj[key] = value;
				lastKey = key;
			}
		}
	}
	if (currentObj["Package"] !== undefined) {
		currentObj["Repo"] = source.baseURL;
		ret.packages[currentObj["Package"]] = currentObj;
		currentObj = {};
	}
	cb(ret);
}

function decompressPackageList(path, cb) {
	decompress(path, ".gz", function (err, content) {
		cb(err, content);
	});
}

var packageList = {};

function savePackageList(cb) {
	var filesList = [];
	for (var i in packageList) {
		filesList.push(i);
	}
	fs.writeFile("packageFiles.json", JSON.stringify(filesList, 0, "\t"), "utf8", function (err) {
		if (err) throw err;
		cb();
	});
}

function loadPackageCache(cb) {
	fs.readFile("packageFiles.json", "utf8", function (err, content) { // the start is not cheap
		if (err) throw err;
		var filesList = JSON.parse(content);
		var filesCount = filesList.length;
		filesList.forEach(function (i) {
			fs.readFile(i, "utf8", function (err, content) {
				if (err) throw err;
				content = JSON.parse(content);
				packageList[i] = content.packages;
				filesCount--;
				if (filesCount <= 0) {
					cb();
				}
			});
		});
	});
}

function updateRepo(source, cb) {
	var fetchURL = source.baseURL + "binary-" + arch + "/Packages.gz";
	
	createIfNotExist(path.join(tempDir, source.cacheFolder), function () {
		var packagesFilename = path.join(source.cacheFolder, "Packages.gz");
		var packagesTempFilename = path.join(tempDir, packagesFilename);
		var packagesCacheFilename = path.join(cacheDir, source.cacheFolder, "Packages.json");

		console.log("Downloading: " + packagesFilename);
		
		httpDownloadToPath(fetchURL, packagesTempFilename, function (err) {
			if (err) throw err;

			console.log("Downloaded: " + packagesFilename);

			decompressPackageList(packagesTempFilename, function (err, content) {
				if (err) throw err;

				console.log("Decompressed: " + packagesFilename);

				parsePackageList(source, content, function (lines) {

					console.log("Parsed: " + packagesFilename);

					createIfNotExist(path.join(cacheDir, source.cacheFolder), function () {
						fs.writeFile(packagesCacheFilename, JSON.stringify(lines, 0, '\t'), "utf8", function (err) {
							if (err) throw err;

							packageList[packagesCacheFilename] = null;
							cb();
						});
					});
				});
			});
		}, true);
	});
}

function updateRepoCache(sourcesList, cb) {
	cacheExists(function () {
		tempExists(function () {
			var sourceCount = sourcesList.length;
			sourcesList.forEach(function (i) {
				updateRepo(i, function () {
					sourceCount--;
					if (sourceCount < 1) {
						savePackageList(function () {
							cb();
						});
					}
				});
			});
		});
	});
}

function getPackageInfo(name) {
	var results = [];
	for (var i in packageList) {
		var list = packageList[i];
		if (list[name] !== undefined) {
			results.push(list[name]);
		}
	}
	return results;
}

function searchAll(name) {
	var results = [];
	for (var i in packageList) {
		var list = packageList[i];
		for (var pName in list) {
			var p = list[pName];
			if (pName.indexOf(name) !== -1) {
				results.push(p);
			}
		}
	}
	return results;

}

function walkDepends(name, recommends, ret) {
	if (ret === undefined) ret = {};
	var results = getPackageInfo(name); // now it's really cheap
	if (results.length === 0) {
		return ret;
	} else {
		var result = results[0];
		ret[result["Package"]] = result;
		if (result["Pre-Depends"] !== undefined) {
			result["Pre-Depends"].forEach(function (i) {
				var dependName = i;
				if (dependName.indexOf(" ") !== -1) {
					dependName = dependName.substring(0, dependName.indexOf(" "));
				}
				if (ret[dependName] === undefined) {
					walkDepends(dependName, false, ret);
				}
			});
		}
		if (result["Depends"] !== undefined) {
			result["Depends"].forEach(function (i) {
				var dependName = i;
				if (dependName.indexOf(" ") !== -1) {
					dependName = dependName.substring(0, dependName.indexOf(" "));
				}
				if (ret[dependName] === undefined) {
					walkDepends(dependName, false, ret);
				}
			});
		}
		if (recommends) {
			if (result["Recommends"] !== undefined) {
				result["Recommends"].forEach(function (i) {
					var dependName = i;
					if (dependName.indexOf(" ") !== -1) {
						dependName = dependName.substring(0, dependName.indexOf(" "));
					}
					if (ret[dependName] === undefined) {
						walkDepends(dependName, false, ret);
					}
				});
			}
		}
	}
	return ret;
}

function _downloadDeb(pack, cb) {
	var filename = path.join(cacheDir, pack["Filename"].filename);
	fs.exists(filename, function (e) {
		if (e) {
			console.log("Skipping: " + pack["Package"]);
		}
	});
	console.log("Downloading: " + pack["Package"] + " : " + (pack["Size"] / 1024 / 1024).toFixed(3) + "Mb");
	httpDownloadToPath(pack["Filename"].fullURL, filename, function (err) {
		console.log("Downloaded: " + pack["Package"]);
		cb(undefined);
	}, true);
}

function downloadDeb(filename, recurse, cb) {
	if (recurse) {
		results = walkDepends(filename, false);
		for (var i in results) {
			_downloadDeb(results[i], function () { });
		}
	} else {
		var results = getPackageInfo(filename);
		if (results.length === 0) {
			cb(undefined);
		}
		_downloadDeb(results[0], cb);
	}
}

function main(args) {
	fs.readFile(sourcesList, "utf8", function (err, content) { // load sourcesList
		if (err) throw err;
		var sourcesList = parseSourcesList(content);
		args = args.slice(2);
		if (args[0] === "update") {
			updateRepoCache(sourcesList, function () {
				console.log("Finished");
			});
		} else if (args[0] === "info") {
			loadPackageCache(function () {
				var results = getPackageInfo(args[1]);
				results.forEach(function (info) {
					console.log(JSON.stringify(info, 0, "\t"));
				});
				console.log("Got " + results.length + " results");
			});
		} else if (args[0] === "search") {
			loadPackageCache(function () {
				var results = searchAll(args[1]);
				results.forEach(function (info) {
					console.log(info["Package"] + " [" + info["Version"] + "] : " + info["Description"]);
				});
				console.log("Got " + results.length + " results");
			});
		} else if (args[0] === "walkDepends") {
			loadPackageCache(function () {
				var results = walkDepends(args[1], args[2] === "true");
				var resultCount = 0;
				var totalSize = 0;
				for (var i in results) {
					var info = results[i];
					console.log(info["Package"] + " [" + info["Version"] + "] : " + info["Description"]);
					totalSize += parseInt(info["Size"], 10);
					resultCount++;
				}
				console.log(args[1] + " has " + resultCount + " Depends with a total size of " + (totalSize / 1024 / 1024).toFixed(3) + "MB");
			});
		} else if (args[0] === "download") {
			loadPackageCache(function () {
				downloadDeb(args[1], args[2] === "true", function (filename) {

				});
			});
		} else {
			console.error("nodeDeb : command not found : " + args[0]);
		}
	});
}

if (module !== undefined) {
	module.exports = exports;
	if (require.main === module) {
		main(process.argv);
	}
}